import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decrypt, digest, encrypt } from "@/lib/crypto";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertPublicUrl, deliver, post, webhookEvents } from "./outbound";
import { securityEvent } from "@/modules/auth/security";

export const integrationCategories = [
  "ACCOUNTING",
  "ERP",
  "PAYROLL",
  "PAYMENT_GATEWAY",
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "STORAGE",
  "IDENTITY",
] as const;
export const apiScopes = [
  "employees.read",
  "employees.write",
  "attendance.read",
  "attendance.write",
  "leave.read",
  "leave.write",
  "payroll.read",
] as const;
const text = z.string().trim().min(1).max(100);
const accountMapping = z
  .object({
    salaryExpense: text,
    pfEmployerContribution: text,
    esiEmployerContribution: text,
    tdsPayable: text,
    salaryPayable: text,
    otherDeductions: text,
    pfPayable: text.optional(),
    esiPayable: text.optional(),
    ptPayable: text.optional(),
    reimbursementExpense: text.optional(),
  })
  .strict();
const integrationSchema = z
  .object({
    category: z.enum(integrationCategories),
    provider: text,
    name: text,
    active: z.boolean().default(true),
    config: z
      .object({
        endpointUrl: z.string().url().max(500).optional(),
        accountMapping: accountMapping.optional(),
      })
      .strict()
      .default({}),
    secret: z.string().min(8).max(4000).optional(),
  })
  .strict();
const webhookSchema = z
  .object({
    name: text,
    url: z.string().url().max(500),
    events: z.array(z.enum(webhookEvents)).min(1),
    active: z.boolean().default(true),
  })
  .strict();
const apiKeySchema = z
  .object({
    name: text,
    scopes: z.array(z.enum(apiScopes)).min(1),
    expiresInDays: z.number().int().min(1).max(730).optional(),
  })
  .strict();
const page = (req: NextRequest) =>
  z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    })
    .parse({
      page: req.nextUrl.searchParams.get("page") ?? undefined,
      pageSize: req.nextUrl.searchParams.get("pageSize") ?? undefined,
    });
const hint = (secret: string) => `••••${secret.slice(-4)}`;
const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;
const defaultMapping = {
  salaryExpense: "Salary Expense",
  pfEmployerContribution: "PF Employer Contribution",
  esiEmployerContribution: "ESI Employer Contribution",
  tdsPayable: "TDS Payable",
  salaryPayable: "Salary Payable",
  otherDeductions: "Other Deductions",
  pfPayable: "PF Payable",
  esiPayable: "ESI Payable",
  ptPayable: "Professional Tax Payable",
  reimbursementExpense: "Employee Reimbursements",
};

async function findIntegration(ctx: Context, id: string) {
  const found = await db.integration.findFirst({
    where: { id, companyId: ctx.companyId, category: { not: "BIOMETRIC" } },
    include: { credential: true },
  });
  if (!found) throw new AppError(404, "Integration not found.");
  return found;
}
function publicIntegration<
  T extends { credential: { hint: string; rotatedAt: Date } | null },
>({ credential, ...i }: T) {
  return {
    ...i,
    credential: credential
      ? { hint: credential.hint, rotatedAt: credential.rotatedAt }
      : null,
  };
}
// Sends a request to an integration endpoint and records the attempt.
async function callIntegration(
  ctx: Context,
  integrationId: string,
  event: string,
  requestData: Prisma.InputJsonValue,
) {
  const integration = await findIntegration(ctx, integrationId);
  const endpoint = (integration.config as { endpointUrl?: string }).endpointUrl;
  if (!integration.active)
    throw new AppError(409, "Enable the integration first.");
  if (!endpoint)
    throw new AppError(
      422,
      "Configure an HTTPS endpoint for this integration.",
    );
  const requestId = randomUUID();
  let status = "FAILED",
    responseData: Prisma.InputJsonValue | undefined,
    errorMessage: string | undefined;
  try {
    const r = await post(
      endpoint,
      JSON.stringify({ requestId, event, data: requestData }),
      {
        "x-request-id": requestId,
        ...(integration.credential
          ? {
              authorization: `Bearer ${decrypt(integration.credential.secretEncrypted).secret}`,
            }
          : {}),
      },
    );
    status = r.ok ? "SUCCESS" : "FAILED";
    responseData = { status: r.status, body: r.text };
    if (!r.ok) errorMessage = `HTTP ${r.status}`;
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message.slice(0, 500) : "Request failed";
  }
  const log = await db.$transaction(async (tx) => {
    await tx.integration.update({
      where: { id: integration.id },
      data: { lastStatus: status, lastUsedAt: new Date() },
    });
    return tx.integrationLog.create({
      data: {
        companyId: ctx.companyId,
        integrationId: integration.id,
        requestId,
        event,
        requestData,
        responseData,
        status,
        errorMessage,
      },
    });
  });
  return log;
}

export async function journal(ctx: Context, from: string, to: string) {
  const [payslips, accounting] = await Promise.all([
    db.payslip.findMany({
      where: {
        companyId: ctx.companyId,
        periodEnd: { gte: new Date(from), lte: new Date(to) },
      },
      select: {
        id: true,
        periodEnd: true,
        grossPay: true,
        deductions: true,
        netPay: true,
        currency: true,
      },
    }),
    db.integration.findFirst({
      where: { companyId: ctx.companyId, category: "ACCOUNTING" },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  // Payslips issued by a payroll run carry the statutory breakdown.
  const items = await db.payrollRunItem.findMany({
    where: {
      companyId: ctx.companyId,
      payslipId: { in: payslips.map((p) => p.id) },
    },
  });
  const byPayslip = new Map(items.map((i) => [i.payslipId, i]));
  const mapping = {
    ...defaultMapping,
    ...((accounting?.config as { accountMapping?: object })?.accountMapping ??
      {}),
  } as typeof defaultMapping;
  const blank = (currency: string) => ({
    currency,
    count: 0,
    gross: 0,
    net: 0,
    erPf: 0,
    eePf: 0,
    erEsi: 0,
    eeEsi: 0,
    pt: 0,
    tds: 0,
    other: 0,
    reimbursements: 0,
  });
  const periods = new Map<string, ReturnType<typeof blank>>();
  for (const p of payslips) {
    const key = `${p.periodEnd.toISOString().slice(0, 7)}|${p.currency}`;
    const row = periods.get(key) ?? blank(p.currency);
    const i = byPayslip.get(p.id);
    row.count++;
    row.gross += p.grossPay;
    row.net += p.netPay;
    if (i) {
      row.erPf += i.pfEmployerEpf + i.pfEmployerEps + i.edli + i.pfAdmin;
      row.eePf += i.pfEmployee;
      row.erEsi += i.esiEmployer;
      row.eeEsi += i.esiEmployee;
      row.pt += i.pt;
      row.tds += i.tds;
      row.other += i.otherDeductions;
      row.reimbursements += i.reimbursements;
    } else row.other += p.deductions;
    periods.set(key, row);
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  const entries = [...periods.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, r]) => {
      const lines = [
        { account: mapping.salaryExpense, debit: r.gross, credit: 0 },
        { account: mapping.pfEmployerContribution, debit: r.erPf, credit: 0 },
        { account: mapping.esiEmployerContribution, debit: r.erEsi, credit: 0 },
        {
          account: mapping.reimbursementExpense,
          debit: r.reimbursements,
          credit: 0,
        },
        { account: mapping.salaryPayable, debit: 0, credit: r.net },
        { account: mapping.pfPayable, debit: 0, credit: r.eePf + r.erPf },
        { account: mapping.esiPayable, debit: 0, credit: r.eeEsi + r.erEsi },
        { account: mapping.ptPayable, debit: 0, credit: r.pt },
        { account: mapping.tdsPayable, debit: 0, credit: r.tds },
        { account: mapping.otherDeductions, debit: 0, credit: r.other },
      ]
        .filter((l) => l.debit || l.credit)
        .map((l) => ({ ...l, debit: round(l.debit), credit: round(l.credit) }));
      const sum = (k: "debit" | "credit") =>
        round(lines.reduce((s, l) => s + l[k], 0));
      return {
        period: key.split("|")[0],
        currency: r.currency,
        payslips: r.count,
        lines,
        balanced: sum("debit") === sum("credit"),
      };
    });
  return {
    from,
    to,
    mapping,
    entries,
    note: "Payslips from payroll runs are posted with PF, ESI, PT and TDS lines; manually entered payslips post their total deductions to the other deductions account.",
  };
}
async function exportFile(
  data: Awaited<ReturnType<typeof journal>>,
  format: "csv" | "json" | "xlsx",
) {
  const name = `accounting-journal-${data.from}-to-${data.to}`;
  const rows = data.entries.flatMap((e) =>
    e.lines.map((l) => [e.period, e.currency, l.account, l.debit, l.credit]),
  );
  if (format === "json")
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${name}.json"`,
        "cache-control": "no-store",
      },
    });
  if (format === "csv") {
    const cell = (v: string | number) => {
      const s = String(v);
      return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
    };
    const csv = [["Period", "Currency", "Account", "Debit", "Credit"], ...rows]
      .map((r) => r.map(cell).join(","))
      .join("\r\n");
    return new NextResponse("﻿" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Journal");
  sheet.addRow(["Period", "Currency", "Account", "Debit", "Credit"]);
  rows.forEach((r) => sheet.addRow(r));
  return new NextResponse(new Uint8Array(await book.xlsx.writeBuffer()), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

export async function integrationsRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  requirePermission(ctx, "integrations.manage");
  const [, resource, id, action] = path;
  const method = req.method;

  if (!resource && method === "GET") {
    const items = await db.integration.findMany({
      where: { companyId: ctx.companyId, category: { not: "BIOMETRIC" } },
      include: { credential: true },
      orderBy: { name: "asc" },
    });
    return {
      items: items.map(publicIntegration),
      categories: integrationCategories,
      webhookEvents,
      apiScopes,
    };
  }
  if (resource === "connections" && (method === "POST" || method === "PUT")) {
    const b = integrationSchema.parse(await json(req));
    if (b.config.endpointUrl) await assertPublicUrl(b.config.endpointUrl);
    const old = id ? await findIntegration(ctx, id) : null;
    if (method === "PUT" && !old)
      throw new AppError(404, "Integration not found.");
    const { secret, ...data } = b;
    return db.$transaction(async (tx) => {
      const saved = old
        ? await tx.integration.update({ where: { id: old.id }, data })
        : await tx.integration.create({
            data: { ...data, companyId: ctx.companyId },
          });
      if (secret)
        await tx.integrationCredential.upsert({
          where: { integrationId: saved.id },
          create: {
            companyId: ctx.companyId,
            integrationId: saved.id,
            secretEncrypted: encrypt({ secret }),
            hint: hint(secret),
          },
          update: {
            secretEncrypted: encrypt({ secret }),
            hint: hint(secret),
            rotatedAt: new Date(),
          },
        });
      await audit(
        tx,
        ctx,
        old ? "UPDATE" : "CREATE",
        "integrations",
        saved.id,
        old ? { name: old.name, active: old.active } : undefined,
        { ...data, secretChanged: !!secret },
        ip(req),
      );
      return { ...saved, credentialSet: !!secret || !!old?.credential };
    });
  }
  if (
    resource === "connections" &&
    id &&
    action === "test" &&
    method === "POST"
  )
    return callIntegration(ctx, id, "integration.test", {
      sentAt: new Date().toISOString(),
    });

  if (resource === "logs" && !id && method === "GET") {
    const { page: p, pageSize } = page(req);
    const integrationId = req.nextUrl.searchParams.get("integrationId");
    const where = {
      companyId: ctx.companyId,
      ...(integrationId ? { integrationId } : {}),
    };
    const [items, total] = await db.$transaction([
      db.integrationLog.findMany({
        where,
        include: { integration: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * pageSize,
        take: pageSize,
      }),
      db.integrationLog.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }
  if (resource === "logs" && id && action === "retry" && method === "POST") {
    const log = await db.integrationLog.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!log?.integrationId)
      throw new AppError(404, "Retryable integration log not found.");
    if (log.status === "SUCCESS")
      throw new AppError(409, "This request already succeeded.");
    return callIntegration(
      ctx,
      log.integrationId,
      log.event,
      (log.requestData ?? {}) as Prisma.InputJsonValue,
    );
  }
  if (resource === "api-logs" && method === "GET") {
    const { page: p, pageSize } = page(req);
    const where = { companyId: ctx.companyId };
    const [items, total] = await db.$transaction([
      db.apiLog.findMany({
        where,
        include: { apiKey: { select: { name: true, prefix: true } } },
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * pageSize,
        take: pageSize,
      }),
      db.apiLog.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }

  if (resource === "webhooks") {
    if (!id && method === "GET")
      return (
        await db.webhook.findMany({
          where: { companyId: ctx.companyId },
          include: {
            _count: {
              select: { deliveries: { where: { status: "FAILED" } } },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      ).map(({ secretEncrypted: _, _count, ...w }) => ({
        ...w,
        failedDeliveries: _count.deliveries,
      }));
    if ((!id && method === "POST") || (id && !action && method === "PUT")) {
      const b = webhookSchema.parse(await json(req));
      await assertPublicUrl(b.url);
      const old = id
        ? await db.webhook.findFirst({
            where: { id, companyId: ctx.companyId },
          })
        : null;
      if (id && !old) throw new AppError(404, "Webhook not found.");
      const secret = old ? null : newSecret();
      return db.$transaction(async (tx) => {
        const saved = old
          ? await tx.webhook.update({ where: { id: old.id }, data: b })
          : await tx.webhook.create({
              data: {
                ...b,
                companyId: ctx.companyId,
                secretEncrypted: encrypt({ secret }),
              },
            });
        await audit(
          tx,
          ctx,
          old ? "UPDATE" : "CREATE",
          "webhooks",
          saved.id,
          old ? { url: old.url, events: old.events } : undefined,
          b,
          ip(req),
        );
        const { secretEncrypted: _, ...rest } = saved;
        // The signing secret is shown once, when it is created or rotated.
        return secret ? { ...rest, secret } : rest;
      });
    }
    if (id && action === "rotate-secret" && method === "POST") {
      const secret = newSecret();
      return db.$transaction(async (tx) => {
        const changed = await tx.webhook.updateMany({
          where: { id, companyId: ctx.companyId },
          data: { secretEncrypted: encrypt({ secret }) },
        });
        if (!changed.count) throw new AppError(404, "Webhook not found.");
        await audit(
          tx,
          ctx,
          "ROTATE_SECRET",
          "webhooks",
          id,
          undefined,
          undefined,
          ip(req),
        );
        return { id, secret };
      });
    }
    if (id && action === "deliveries" && method === "GET") {
      const { page: p, pageSize } = page(req);
      const where = { companyId: ctx.companyId, webhookId: id };
      const [items, total] = await db.$transaction([
        db.webhookDelivery.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (p - 1) * pageSize,
          take: pageSize,
        }),
        db.webhookDelivery.count({ where }),
      ]);
      return { items, total, page: p, pageSize };
    }
  }
  if (
    resource === "deliveries" &&
    id &&
    action === "retry" &&
    method === "POST"
  ) {
    const changed = await db.webhookDelivery.updateMany({
      where: {
        id,
        companyId: ctx.companyId,
        status: { in: ["FAILED", "PENDING"] },
      },
      data: { status: "PENDING", nextAttemptAt: new Date() },
    });
    if (!changed.count)
      throw new AppError(404, "Pending or failed delivery not found.");
    await deliver(id);
    return db.webhookDelivery.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        status: true,
        attempts: true,
        responseStatus: true,
        errorMessage: true,
        deliveredAt: true,
      },
    });
  }

  if (resource === "api-keys") {
    if (!id && method === "GET")
      return db.apiKey.findMany({
        where: { companyId: ctx.companyId },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    if (!id && method === "POST") {
      const b = apiKeySchema.parse(await json(req));
      const prefix = `hrms_${randomBytes(4).toString("hex")}`;
      const key = `${prefix}_${randomBytes(24).toString("base64url")}`;
      return db.$transaction(async (tx) => {
        const saved = await tx.apiKey.create({
          data: {
            companyId: ctx.companyId,
            name: b.name,
            prefix,
            keyHash: digest(key),
            scopes: [...new Set(b.scopes)],
            createdBy: ctx.userId,
            expiresAt: b.expiresInDays
              ? new Date(Date.now() + b.expiresInDays * 86400000)
              : null,
          },
        });
        await audit(
          tx,
          ctx,
          "CREATE",
          "api_keys",
          saved.id,
          undefined,
          { name: b.name, scopes: b.scopes },
          ip(req),
        );
        await securityEvent(tx, {
          companyId: ctx.companyId,
          userId: ctx.userId,
          type: "API_KEY_CREATED",
          severity: "WARNING",
          details: { apiKeyId: saved.id, scopes: saved.scopes },
          ip: ip(req),
        });
        // Only a hash is stored; the key cannot be shown again.
        return {
          id: saved.id,
          name: saved.name,
          prefix,
          scopes: saved.scopes,
          expiresAt: saved.expiresAt,
          key,
        };
      });
    }
    if (id && method === "DELETE")
      return db.$transaction(async (tx) => {
        const changed = await tx.apiKey.updateMany({
          where: { id, companyId: ctx.companyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (!changed.count)
          throw new AppError(404, "Active API key not found.");
        await audit(
          tx,
          ctx,
          "REVOKE",
          "api_keys",
          id,
          undefined,
          undefined,
          ip(req),
        );
        await securityEvent(tx, {
          companyId: ctx.companyId,
          userId: ctx.userId,
          type: "API_KEY_REVOKED",
          details: { apiKeyId: id },
          ip: ip(req),
        });
        return { id, revoked: true };
      });
  }

  if (resource === "accounting-export") {
    const range = z
      .object({ from: z.iso.date(), to: z.iso.date() })
      .refine((v) => v.from <= v.to, "Choose an ordered date range.");
    if (method === "GET") {
      const q = range
        .and(
          z.object({ format: z.enum(["csv", "json", "xlsx"]).default("json") }),
        )
        .parse(Object.fromEntries(req.nextUrl.searchParams));
      return exportFile(await journal(ctx, q.from, q.to), q.format);
    }
    if (id === "push" && method === "POST") {
      const b = range
        .and(z.object({ integrationId: z.string().min(1) }))
        .parse(await json(req));
      const integration = await findIntegration(ctx, b.integrationId);
      if (integration.category !== "ACCOUNTING")
        throw new AppError(422, "Choose an accounting integration.");
      return callIntegration(
        ctx,
        integration.id,
        "accounting.journal",
        (await journal(ctx, b.from, b.to)) as unknown as Prisma.InputJsonValue,
      );
    }
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
