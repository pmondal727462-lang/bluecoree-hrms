import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { digest } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { emailConfigured, sendAuthEmail } from "@/integrations/email";
import {
  audit,
  ip,
  issueSession,
  json,
  provisionCompany,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { password } from "@/modules/shared/validators";
import { product } from "@/config/product";

const signupSchema = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    adminName: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    phone: z.string().trim().max(30).optional(),
    password,
    timezone: z.string().trim().max(60).default("Asia/Kolkata"),
    acceptTerms: z.literal(true, { error: "Accept the terms to continue." }),
    // Honeypot for form bots.
    website: z.string().max(200).optional(),
  })
  .strict();
const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(200),
    company: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    employees: z.number().int().min(1).max(1000000).optional(),
    message: z.string().trim().min(5).max(3000),
    website: z.string().max(200).optional(),
  })
  .strict();

// A short, unique company code from the company name, e.g. ACME4821.
async function companyCode(name: string) {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "COMPANY";
  for (let i = 0; i < 20; i++) {
    const code = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const taken =
      (await db.company.findUnique({
        where: { code },
        select: { id: true },
      })) ||
      (await db.signupRequest.findFirst({
        where: {
          companyCode: code,
          verifiedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }));
    if (!taken) return code;
  }
  throw new AppError(503, "Could not allocate a company code. Try again.");
}

// Public self-service signup (spec §75-76): register, verify email, then the
// company is created on a free trial and the owner is signed in.
export async function signupRoute(req: NextRequest, path: string[]) {
  const [, , action] = path;
  if (!action && req.method === "POST") {
    await rateLimit(`signup:${ip(req)}`, 5);
    const b = signupSchema.parse(await json(req));
    const reply = {
      sent: true,
      message: `We sent a verification link to ${b.email}. It is valid for 24 hours.`,
    };
    if (b.website) return reply;
    await rateLimit(`signup-email:${digest(b.email)}`, 3);
    const token = randomBytes(32).toString("base64url");
    const code = await companyCode(b.companyName);
    await db.signupRequest.create({
      data: {
        companyName: b.companyName,
        companyCode: code,
        adminName: b.adminName,
        email: b.email,
        phone: b.phone,
        timezone: b.timezone,
        passwordHash: await bcrypt.hash(b.password, 12),
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 86400000),
        ip: ip(req),
      },
    });
    const link = `${process.env.APP_URL ?? ""}/verify/${token}`;
    if (emailConfigured())
      await sendAuthEmail(
        b.email,
        `Verify your email to start your ${product.name} trial`,
        `Hello ${b.adminName},\n\nConfirm your email to create ${b.companyName} on ${product.name}:\n${link}\n\nThe link is valid for 24 hours. If you did not sign up, ignore this email.`,
      ).catch(() => undefined);
    // Without email delivery (development), the link is returned instead.
    return process.env.NODE_ENV === "production" || emailConfigured()
      ? reply
      : { ...reply, devLink: link };
  }
  if (action === "verify" && req.method === "POST") {
    await rateLimit(`signup-verify:${ip(req)}`, 30);
    const b = z
      .object({ token: z.string().min(20).max(200) })
      .strict()
      .parse(await json(req));
    const request = await db.signupRequest.findUnique({
      where: { tokenHash: digest(b.token) },
    });
    if (!request || request.verifiedAt || request.expiresAt < new Date())
      throw new AppError(
        410,
        "This verification link is invalid or has expired. Sign up again.",
        "SIGNUP_LINK_INVALID",
      );
    const user = await db.$transaction(
      async (tx) => {
        // The status guard makes a double click a no-op.
        const claimed = await tx.signupRequest.updateMany({
          where: { id: request.id, verifiedAt: null },
          data: { verifiedAt: new Date() },
        });
        if (!claimed.count)
          throw new AppError(409, "This signup is already complete.");
        const company = await provisionCompany(tx, {
          code: request.companyCode,
          name: request.companyName,
          email: request.email,
          phone: request.phone ?? undefined,
          timezone: request.timezone,
          workingDays: [1, 2, 3, 4, 5],
        });
        const role = await tx.role.findUniqueOrThrow({
          where: {
            companyId_name: { companyId: company.id, name: "Company Owner" },
          },
        });
        const u = await tx.user.create({
          data: {
            companyId: company.id,
            roleId: role.id,
            name: request.adminName,
            email: request.email,
            passwordHash: request.passwordHash,
          },
        });
        const [firstName, ...rest] = request.adminName.split(/\s+/);
        await tx.employee.create({
          data: {
            companyId: company.id,
            userId: u.id,
            employeeCode: "EMP001",
            firstName,
            lastName: rest.join(" ") || "-",
            officialEmail: request.email,
            joinedAt: new Date(new Date().toISOString().slice(0, 10)),
            status: "Active",
          },
        });
        await tx.signupRequest.update({
          where: { id: request.id },
          data: { companyId: company.id },
        });
        await audit(
          tx,
          { companyId: company.id, userId: u.id, name: u.name },
          "SIGNUP",
          "company",
          company.id,
          undefined,
          { name: company.name, code: company.code },
          ip(req),
        );
        return u;
      },
      { timeout: 30000 },
    );
    const session = await issueSession(user, req);
    const out = NextResponse.json({
      success: true,
      data: { name: user.name, companyCode: request.companyCode },
    });
    for (const c of session.cookies.getAll()) out.cookies.set(c);
    return out;
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

export async function contactRoute(req: NextRequest) {
  await rateLimit(`contact:${ip(req)}`, 5);
  const b = contactSchema.parse(await json(req));
  if (!b.website) {
    const { website: _w, ...lead } = b;
    await db.contactLead.create({ data: { ...lead, ip: ip(req) } });
    if (emailConfigured() && process.env.SALES_EMAIL)
      await sendAuthEmail(
        process.env.SALES_EMAIL,
        `New enquiry from ${b.name}`,
        `${b.name} <${b.email}> ${b.company ?? ""} ${b.phone ?? ""}\nEmployees: ${b.employees ?? "-"}\n\n${b.message}`,
      ).catch(() => undefined);
  }
  return { received: true };
}

// Guided company setup after signup: each step is derived from real data.
export async function setupProgress(ctx: Context) {
  requirePermission(ctx, "company.read");
  const where = { companyId: ctx.companyId };
  const [
    company,
    departments,
    employees,
    leaveTypes,
    holidays,
    shifts,
    statutory,
  ] = await Promise.all([
    db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: {
        address: true,
        billingState: true,
        onboardingDismissedAt: true,
      },
    }),
    db.department.count({ where }),
    db.employee.count({ where }),
    db.leaveType.count({ where }),
    db.holiday.count({ where }),
    db.shift.count({ where }),
    db.statutorySetting.count({ where }),
  ]);
  const steps = [
    [
      "company",
      "Complete company details and billing state",
      !!company.address && !!company.billingState,
      "/subscription",
    ],
    [
      "organization",
      "Review departments and designations",
      departments > 0,
      "/organization",
    ],
    ["employees", "Add or import your employees", employees > 1, "/employees"],
    ["leave", "Set up leave types", leaveTypes > 0, "/time-settings"],
    ["holidays", "Add this year's holidays", holidays > 0, "/time-settings"],
    [
      "shifts",
      "Configure shifts and attendance rules",
      shifts > 0,
      "/time-settings",
    ],
    ["payroll", "Review statutory payroll settings", statutory > 0, "/payroll"],
  ].map(([key, title, done, href]) => ({ key, title, done, href }));
  return {
    steps,
    completed: steps.filter((s) => s.done).length,
    dismissed: !!company.onboardingDismissedAt,
  };
}
export async function dismissSetup(ctx: Context) {
  requirePermission(ctx, "company.write");
  await db.company.update({
    where: { id: ctx.companyId },
    data: { onboardingDismissedAt: new Date() },
  });
  return { dismissed: true };
}
