import { NextRequest, NextResponse } from "next/server";
import { resolveTxt } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage, canUse, requireFeature } from "./service";

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #1d4ed8")
  .nullable();
const text = (max: number) => z.string().trim().max(max).nullable();
const brandingSchema = z
  .object({
    brandName: text(80),
    portalTitle: text(80),
    primaryColor: color,
    secondaryColor: color,
    loginMessage: text(300),
    emailFooter: text(500),
    payslipFooter: text(500),
    customDomain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
        "Enter a domain such as hr.example.com",
      )
      .nullable(),
  })
  .strict();
const maxLogoBytes = 256 * 1024;
const signatures: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};
// Only PNG and JPEG are accepted, checked by declared type, size and file
// signature. SVG and other formats that can carry script are refused.
export function parseLogo(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match) throw new AppError(422, "Upload a PNG or JPEG image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxLogoBytes)
    throw new AppError(422, "The logo must be smaller than 256 KB.");
  if (!signatures[match[1]].every((b, i) => bytes[i] === b))
    throw new AppError(
      422,
      "The file content does not match a PNG or JPEG image.",
    );
  return { type: match[1], bytes };
}
async function whitelabel(companyId: string) {
  return canUse(companyId, "whitelabel");
}
function publicBranding(
  b: {
    brandName: string | null;
    portalTitle: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    loginMessage: string | null;
    logoData: Uint8Array | null;
  },
  code: string,
) {
  return {
    companyCode: code,
    brandName: b.brandName,
    portalTitle: b.portalTitle,
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    loginMessage: b.loginMessage,
    logoUrl: b.logoData
      ? `/api/public/branding/logo?company=${encodeURIComponent(code)}`
      : null,
  };
}
// Branding for the signed-in company, used by the workspace, emails and payslips.
export async function companyBranding(companyId: string) {
  if (!(await whitelabel(companyId))) return null;
  const b = await db.companyBranding.findUnique({
    where: { companyId },
    include: { company: { select: { code: true } } },
  });
  return b
    ? {
        ...publicBranding(b, b.company.code),
        emailFooter: b.emailFooter,
        payslipFooter: b.payslipFooter,
      }
    : null;
}

export async function brandingRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, action, sub] = path;
  if (!action && req.method === "GET") {
    const [enabled, row] = await Promise.all([
      whitelabel(ctx.companyId),
      db.companyBranding.findUnique({ where: { companyId: ctx.companyId } }),
    ]);
    const { logoData, domainToken, ...rest } = row ?? {
      logoData: null,
      domainToken: null,
    };
    return {
      enabled,
      applied: enabled ? await companyBranding(ctx.companyId) : null,
      settings: row
        ? {
            ...rest,
            hasLogo: !!logoData,
            // The verification record is shown only to administrators.
            ...(ctx.permissions.includes("company.write")
              ? { domainToken }
              : {}),
          }
        : null,
    };
  }
  requirePermission(ctx, "company.write");
  await requireFeature(ctx.companyId, "whitelabel");
  if (!action && req.method === "PUT") {
    const b = brandingSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const old = await tx.companyBranding.findUnique({
        where: { companyId: ctx.companyId },
      });
      const domainChanged = (old?.customDomain ?? null) !== b.customDomain;
      const data = {
        ...b,
        ...(domainChanged
          ? {
              domainToken: b.customDomain
                ? `hrms-verify-${randomBytes(16).toString("hex")}`
                : null,
              domainVerifiedAt: null,
            }
          : {}),
      };
      const saved = await tx.companyBranding.upsert({
        where: { companyId: ctx.companyId },
        create: { ...data, companyId: ctx.companyId },
        update: data,
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "branding",
        ctx.companyId,
        undefined,
        b,
        ip(req),
      );
      const { logoData, ...rest } = saved;
      return { ...rest, hasLogo: !!logoData };
    });
  }
  if (action === "logo" && req.method === "POST") {
    const b = z
      .object({ dataUrl: z.string().max(400000) })
      .strict()
      .parse(await json(req, 450000));
    const logo = parseLogo(b.dataUrl);
    await assertStorage(ctx.companyId, logo.bytes.length);
    await db.$transaction(async (tx) => {
      await tx.companyBranding.upsert({
        where: { companyId: ctx.companyId },
        create: {
          companyId: ctx.companyId,
          logoData: logo.bytes,
          logoType: logo.type,
        },
        update: { logoData: logo.bytes, logoType: logo.type },
      });
      await audit(
        tx,
        ctx,
        "UPLOAD_LOGO",
        "branding",
        ctx.companyId,
        undefined,
        { type: logo.type, bytes: logo.bytes.length },
        ip(req),
      );
    });
    return { hasLogo: true, bytes: logo.bytes.length };
  }
  if (action === "logo" && req.method === "DELETE") {
    await db.companyBranding.updateMany({
      where: { companyId: ctx.companyId },
      data: { logoData: null, logoType: null },
    });
    return { hasLogo: false };
  }
  if (action === "domain" && sub === "verify" && req.method === "POST") {
    const row = await db.companyBranding.findUnique({
      where: { companyId: ctx.companyId },
    });
    if (!row?.customDomain || !row.domainToken)
      throw new AppError(422, "Save a custom domain first.");
    let records: string[] = [];
    try {
      records = (await resolveTxt(`_hrms-verify.${row.customDomain}`)).map(
        (r) => r.join(""),
      );
    } catch {
      records = [];
    }
    if (!records.includes(row.domainToken))
      throw new AppError(
        422,
        `TXT record not found. Add _hrms-verify.${row.customDomain} with value ${row.domainToken}, wait for DNS to update, then retry.`,
      );
    const saved = await db.companyBranding.update({
      where: { companyId: ctx.companyId },
      data: { domainVerifiedAt: new Date() },
    });
    return {
      customDomain: saved.customDomain,
      domainVerifiedAt: saved.domainVerifiedAt,
    };
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// Unauthenticated lookups for the login page, by company code or verified domain.
export async function publicBrandingRoute(req: NextRequest, path: string[]) {
  if (req.method !== "GET") throw new AppError(405, "Method not allowed.");
  const code = req.nextUrl.searchParams
    .get("company")
    ?.toUpperCase()
    .slice(0, 24);
  const host = req.nextUrl.searchParams
    .get("host")
    ?.toLowerCase()
    .slice(0, 253);
  const row = code
    ? await db.companyBranding.findFirst({
        where: { company: { code } },
        include: { company: { select: { code: true, id: true } } },
      })
    : host
      ? await db.companyBranding.findFirst({
          where: { customDomain: host, domainVerifiedAt: { not: null } },
          include: { company: { select: { code: true, id: true } } },
        })
      : null;
  const enabled = row ? await whitelabel(row.company.id) : false;
  if (path[2] === "logo") {
    if (!row?.logoData || !enabled)
      throw new AppError(404, "Logo not found.", "NOT_FOUND");
    return new NextResponse(new Uint8Array(row.logoData), {
      headers: {
        "content-type": row.logoType ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "cache-control": "public, max-age=300",
      },
    });
  }
  return row && enabled ? publicBranding(row, row.company.code) : null;
}

// Custom domains (spec §54): a company with white label and a verified
// domain gets links, login and emails on its own domain.
export async function companyAppUrl(companyId: string) {
  const fallback = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const row = await db.companyBranding.findUnique({
    where: { companyId },
    select: { customDomain: true, domainVerifiedAt: true },
  });
  if (!row?.customDomain || !row.domainVerifiedAt) return fallback;
  if (!(await whitelabel(companyId))) return fallback;
  const protocol = fallback.startsWith("http://") ? "http" : "https";
  return `${protocol}://${row.customDomain}`;
}
// The company a verified custom domain belongs to, if any.
export async function companyForHost(host: string | null | undefined) {
  const domain = host?.toLowerCase().split(":")[0];
  if (!domain) return null;
  const row = await db.companyBranding.findFirst({
    where: { customDomain: domain, domainVerifiedAt: { not: null } },
    select: { companyId: true, company: { select: { code: true } } },
  });
  if (!row || !(await whitelabel(row.companyId))) return null;
  return { companyId: row.companyId, code: row.company.code };
}
// For an on-demand TLS proxy (for example Caddy "ask"): certificates are
// issued only for verified white-label domains.
export async function domainCheck(req: NextRequest) {
  const found = await companyForHost(req.nextUrl.searchParams.get("domain"));
  if (!found) throw new AppError(404, "Unknown domain.", "NOT_FOUND");
  return { ok: true };
}
// Brand name and footer for outgoing email, when white label applies.
export async function emailBrand(companyId: string) {
  const b = await companyBranding(companyId);
  return b ? { name: b.brandName, footer: b.emailFooter } : null;
}
