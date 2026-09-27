import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { encrypt, decrypt, digest } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { product } from "@/config/product";
import { faceStatus } from "@/modules/face/routes";
import {
  json,
  rateLimit,
  ip,
  audit,
  type Context,
  issueSession,
  checkSecondFactor,
} from "./service";
import { password, text } from "@/modules/shared/validators";
import { newSecret, verifyTotp } from "./totp";
import { emailConfigured, sendAuthEmail } from "@/integrations/email";
import { enrollFace } from "@/modules/face/service";
import { securityEvent } from "./security";
export async function passwordChange(req: NextRequest, ctx: Context) {
  const b = z
    .object({ currentPassword: z.string().max(72), newPassword: password })
    .strict()
    .parse(await json(req));
  await rateLimit(`password:${ctx.userId}`, 10);
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await bcrypt.compare(b.currentPassword, user.passwordHash)))
    throw new AppError(403, "Current password is incorrect.");
  if (await bcrypt.compare(b.newPassword, user.passwordHash))
    throw new AppError(
      422,
      "Choose a password different from the current one.",
    );
  const hash = await bcrypt.hash(b.newPassword, 12);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: ctx.userId },
      data: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    await tx.session.deleteMany({ where: { userId: ctx.userId } });
    await securityEvent(tx, {
      companyId: ctx.companyId,
      userId: ctx.userId,
      type: "PASSWORD_CHANGED",
      ip: ip(req),
    });
    await audit(
      tx,
      ctx,
      "PASSWORD_CHANGED",
      "auth",
      ctx.userId,
      undefined,
      undefined,
      ip(req),
    );
  });
  return { signInAgain: true };
}
export async function twoFactor(
  req: NextRequest,
  ctx: Context,
  action: string,
) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (action === "status") return { enabled: user.twoFactorEnabled };
  await rateLimit(`2fa:${ctx.userId}`, 10);
  const b = z
    .object({
      password: z.string().max(72),
      code: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    })
    .strict()
    .parse(await json(req));
  if (!(await bcrypt.compare(b.password, user.passwordHash)))
    throw new AppError(403, "Password is incorrect.");
  if (action === "setup") {
    if (user.twoFactorEnabled)
      throw new AppError(409, "Two-factor authentication is already enabled.");
    const secret = newSecret();
    await db.user.update({
      where: { id: ctx.userId },
      data: { twoFactorSecret: encrypt({ secret }), lastTotpStep: null },
    });
    return {
      secret,
      uri: `otpauth://totp/${encodeURIComponent(`${product.name}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(product.name)}&algorithm=SHA1&digits=6&period=30`,
    };
  }
  if (!user.twoFactorSecret || !b.code)
    throw new AppError(422, "An authenticator code is required.");
  const step = verifyTotp(
    decrypt(user.twoFactorSecret).secret,
    b.code,
    user.lastTotpStep,
  );
  if (step === null)
    throw new AppError(403, "Invalid or already used authenticator code.");
  if (action !== "enable" && action !== "disable")
    throw new AppError(404, "Not found.");
  await db.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id: ctx.userId,
        twoFactorSecret: user.twoFactorSecret,
        lastTotpStep: user.lastTotpStep,
      },
      data: {
        twoFactorEnabled: action === "enable",
        twoFactorSecret: action === "enable" ? user.twoFactorSecret : null,
        lastTotpStep: action === "enable" ? BigInt(step) : null,
        ...(action === "disable" ? { recoveryCodeHashes: [] } : {}),
      },
    });
    if (!result.count)
      throw new AppError(409, "Security settings changed. Try again.");
    await tx.session.deleteMany({
      where: { userId: ctx.userId, id: { not: ctx.sessionId } },
    });
    await securityEvent(tx, {
      companyId: ctx.companyId,
      userId: ctx.userId,
      type: action === "enable" ? "MFA_ENABLED" : "MFA_DISABLED",
      severity: action === "enable" ? "INFO" : "WARNING",
      ip: ip(req),
    });
    await audit(
      tx,
      ctx,
      action === "enable" ? "2FA_ENABLED" : "2FA_DISABLED",
      "auth",
      ctx.userId,
      undefined,
      undefined,
      ip(req),
    );
  });
  return { enabled: action === "enable" };
}
export async function requestChallenge(
  req: NextRequest,
  kind: "reset" | "otp",
) {
  await rateLimit(`challenge-ip:${ip(req)}`, 20);
  if (!emailConfigured())
    throw new AppError(
      503,
      "Email delivery is not configured. Contact your administrator.",
      "EMAIL_UNAVAILABLE",
    );
  const b = z
    .object({ companyCode: text, identifier: text })
    .strict()
    .parse(await json(req));
  await rateLimit(
    `challenge-account:${digest(`${b.companyCode}:${b.identifier}`)}`,
    5,
  );
  const company = await db.company.findUnique({
    where: { code: b.companyCode.toUpperCase() },
  });
  const user = company
    ? await db.user.findFirst({
        where: {
          companyId: company.id,
          active: true,
          OR: [{ email: b.identifier.toLowerCase() }, { mobile: b.identifier }],
        },
      })
    : null;
  const id = randomBytes(24).toString("hex");
  if (user) {
    const value =
      kind === "otp"
        ? String(randomInt(100000, 1000000))
        : randomBytes(32).toString("hex");
    const record = await db.authChallenge.create({
      data: {
        id,
        companyId: user.companyId,
        userId: user.id,
        kind,
        tokenHash: digest(`${id}:${value}`),
        expiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
    const { companyBranding } = await import("@/modules/saas/branding");
    const brand = await companyBranding(user.companyId).catch(() => null);
    try {
      await sendAuthEmail(
        user.email,
        kind === "otp"
          ? "Your People sign-in code"
          : "Reset your People password",
        kind === "otp"
          ? `Your sign-in code is ${value}. It expires in 10 minutes. If you did not request this, ignore this email.`
          : `Reset your password within 10 minutes: ${process.env.APP_URL}/reset-password?id=${id}&token=${value}\nIf you did not request this, ignore this email.`,
        brand && { name: brand.brandName, footer: brand.emailFooter },
      );
    } catch {
      await db.authChallenge.delete({ where: { id: record.id } });
      throw new AppError(
        503,
        "Email delivery failed. Please try again later.",
        "EMAIL_UNAVAILABLE",
      );
    }
  }
  await db.authChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 86400000) } },
  });
  return {
    challengeId: id,
    message:
      "If the account exists, instructions have been sent to its email address.",
  };
}
export async function redeemChallenge(req: NextRequest, kind: "reset" | "otp") {
  const b = z
    .object({
      challengeId: text,
      token: z.string().min(6).max(100),
      newPassword: password.optional(),
      totp: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    })
    .strict()
    .parse(await json(req));
  await rateLimit(`redeem:${digest(b.challengeId)}`, 5);
  await rateLimit(`redeem-ip:${ip(req)}`, 50);
  const challenge = await db.authChallenge.findFirst({
    where: {
      id: b.challengeId,
      kind,
      tokenHash: digest(`${b.challengeId}:${b.token}`),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!challenge)
    throw new AppError(
      400,
      "The code or link is invalid or expired.",
      "INVALID_CHALLENGE",
    );
  const user = await db.user.findFirst({
    where: {
      id: challenge.userId,
      companyId: challenge.companyId,
      active: true,
    },
  });
  if (!user)
    throw new AppError(
      400,
      "The code or link is invalid or expired.",
      "INVALID_CHALLENGE",
    );
  await checkSecondFactor(user, b.totp);
  if (kind === "reset" && !b.newPassword)
    throw new AppError(422, "New password is required.");
  const hash = kind === "reset" ? await bcrypt.hash(b.newPassword!, 12) : null;
  await db.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new AppError(400, "This code has already been used.");
    if (hash) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.authChallenge.updateMany({
        where: { userId: user.id, kind: "reset", usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    await audit(
      tx,
      { companyId: user.companyId, userId: user.id, name: user.name },
      kind === "reset" ? "PASSWORD_RESET" : "OTP_LOGIN",
      "auth",
      user.id,
      undefined,
      undefined,
      ip(req),
    );
  });
  return kind === "otp" ? issueSession(user, req) : { signInAgain: true };
}

export async function employeePasswordSetup(req: NextRequest) {
  const b = z
    .object({
      companyCode: text,
      employeeCode: text,
      token: z.string().min(16).max(100),
      newPassword: password,
      faceSample: z.string().max(2_000_000).optional(),
      faceConsent: z.boolean().optional(),
    })
    .strict()
    .parse(await json(req, 400000));
  await rateLimit(
    `employee-setup:${digest(`${b.companyCode}:${b.employeeCode}`)}`,
    5,
  );
  const company = await db.company.findUnique({
    where: { code: b.companyCode.toUpperCase() },
  });
  const user = company
    ? await db.user.findFirst({
        where: {
          companyId: company.id,
          active: true,
          employee: {
            employeeCode: { equals: b.employeeCode, mode: "insensitive" },
          },
        },
        include: { employee: { select: { id: true, faceRequired: true } } },
      })
    : null;
  const challenge = user
    ? await db.authChallenge.findFirst({
        where: {
          companyId: user.companyId,
          userId: user.id,
          kind: "employee_setup",
          tokenHash: digest(`${user.id}:${b.token}`),
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
    : null;
  if (!user || !challenge)
    throw new AppError(
      400,
      "The employee setup code is invalid or expired.",
      "INVALID_CHALLENGE",
    );
  const { required: faceRequired } = await faceStatus(user.id, user.companyId);
  const existingFace = user.employee
    ? await db.faceProfile.findUnique({
        where: { employeeId: user.employee.id },
      })
    : null;
  if (faceRequired && !existingFace && (!b.faceSample || !b.faceConsent))
    throw new AppError(
      422,
      "Face capture is mandatory before first login.",
      "FACE_ENROLLMENT_REQUIRED",
    );
  const faceTemplate =
    faceRequired && !existingFace ? await enrollFace(b.faceSample!) : null;
  const hash = await bcrypt.hash(b.newPassword, 12);
  await db.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new AppError(400, "This setup code has already been used.");
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        mustSetPassword: false,
        passwordSetAt: new Date(),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    if (faceTemplate && user.employee)
      await tx.faceProfile.create({
        data: {
          companyId: user.companyId,
          employeeId: user.employee.id,
          templateCiphertext: faceTemplate,
        },
      });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await audit(
      tx,
      { companyId: user.companyId, userId: user.id, name: user.name },
      "EMPLOYEE_PASSWORD_CREATED",
      "auth",
      user.id,
      undefined,
      undefined,
      ip(req),
    );
  });
  return { signInAgain: true };
}
