import { NextRequest, NextResponse } from "next/server";
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
import { parseLogo } from "@/modules/saas/branding";
import { assertStorage } from "@/modules/saas/service";

const text = (max: number) => z.string().trim().max(max).nullable();
const settingsSchema = z
  .object({
    legalName: text(200),
    city: text(100),
    state: text(100),
    pinCode: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z -]{3,12}$/, "Enter a valid PIN or postal code")
      .nullable(),
    country: z.string().trim().min(2).max(80),
    currency: z.string().trim().length(3).toUpperCase(),
    dateFormat: z.enum([
      "DD/MM/YYYY",
      "MM/DD/YYYY",
      "YYYY-MM-DD",
      "DD-MMM-YYYY",
    ]),
    financialYearStartMonth: z.number().int().min(1).max(12),
    payrollCycle: z.enum(["MONTHLY"]),
    payrollCutoffDay: z.number().int().min(1).max(31).nullable(),
  })
  .strict();
export async function companySettings(companyId: string) {
  const row = await db.companySetting.findUnique({ where: { companyId } });
  const { logoData, ...rest } = row ?? {
    companyId,
    legalName: null,
    city: null,
    state: null,
    pinCode: null,
    country: "India",
    currency: "INR",
    dateFormat: "DD/MM/YYYY",
    financialYearStartMonth: 4,
    payrollCycle: "MONTHLY",
    payrollCutoffDay: null,
    logoType: null,
    logoData: null,
  };
  return { ...rest, hasLogo: !!logoData };
}
export async function companyLogo(companyId: string) {
  const row = await db.companySetting.findUnique({
    where: { companyId },
    select: { logoData: true, logoType: true },
  });
  return row?.logoData
    ? { bytes: row.logoData, type: row.logoType ?? "image/png" }
    : null;
}

export async function settingsRoute(
  req: NextRequest,
  ctx: Context,
  action?: string,
) {
  if (action === "logo" && req.method === "GET") {
    const logo = await companyLogo(ctx.companyId);
    if (!logo) throw new AppError(404, "No company logo.");
    return new NextResponse(new Uint8Array(logo.bytes), {
      headers: {
        "content-type": logo.type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "cache-control": "private, max-age=300",
      },
    });
  }
  if (!action && req.method === "GET") {
    requirePermission(ctx, "company.read");
    return companySettings(ctx.companyId);
  }
  requirePermission(ctx, "company.write");
  if (!action && req.method === "PUT") {
    const b = settingsSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      await tx.companySetting.upsert({
        where: { companyId: ctx.companyId },
        create: { ...b, companyId: ctx.companyId },
        update: b,
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "company_settings",
        ctx.companyId,
        undefined,
        b,
        ip(req),
      );
      return companySettings(ctx.companyId);
    });
  }
  if (action === "logo" && req.method === "POST") {
    const b = z
      .object({ dataUrl: z.string().max(400000) })
      .strict()
      .parse(await json(req, 450000));
    const logo = parseLogo(b.dataUrl);
    await assertStorage(ctx.companyId, logo.bytes.length);
    await db.companySetting.upsert({
      where: { companyId: ctx.companyId },
      create: {
        companyId: ctx.companyId,
        logoData: logo.bytes,
        logoType: logo.type,
      },
      update: { logoData: logo.bytes, logoType: logo.type },
    });
    return { hasLogo: true };
  }
  if (action === "logo" && req.method === "DELETE") {
    await db.companySetting.updateMany({
      where: { companyId: ctx.companyId },
      data: { logoData: null, logoType: null },
    });
    return { hasLogo: false };
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}
