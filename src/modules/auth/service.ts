import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { digest, decrypt } from "@/lib/crypto";
import { verifyTotp } from "./totp";
import { signToken, verifyToken } from "./tokens";
import {
  consumeRecoveryCode,
  recordLogin,
  registerFailure,
  roleTier,
  securityGate,
  securityPolicy,
} from "./security";
import {
  permissions,
  defaultGrants,
  roleNames,
  type PermissionKey,
} from "@/config/permissions";
import {
  companySchema,
  loginSchema,
  mobileLoginSchema,
  setupSchema,
} from "@/modules/shared/validators";
import { z } from "zod";
import { effectivePermissions } from "@/lib/employee-access";

export type Context = {
  userId: string;
  companyId: string;
  name: string;
  roleId: string;
  roleName: string;
  isSuperAdmin: boolean;
  permissions: string[];
  sessionId: string;
  mfaSetupRequired?: boolean;
  passwordChangeRequired?: boolean;
  temporaryPassword?: boolean;
};
export function ip(req: NextRequest) {
  return process.env.TRUST_PROXY === "true"
    ? req.headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 64) ||
        "unknown"
    : "local";
}
export async function rateLimit(key: string, limit = 20) {
  const now = new Date();
  const bucket = `${key}:${Math.floor(now.getTime() / 600000)}`;
  const record = await db.rateLimit.upsert({
    where: { key: bucket },
    create: {
      key: bucket,
      count: 1,
      expiresAt: new Date(now.getTime() + 600000),
    },
    update: { count: { increment: 1 } },
  });
  if (record.count > limit)
    throw new AppError(
      429,
      "Too many attempts. Try again in 10 minutes.",
      "RATE_LIMITED",
    );
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
}
export async function csrf(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (new URL(req.url).pathname.includes("/api/v1/auth/")) return;
  // Device push URLs carry their own token and never use session cookies.
  if (new URL(req.url).pathname.startsWith("/api/biometric/hikvision/")) return;
  // The payment webhook is authenticated by its body signature.
  if (new URL(req.url).pathname === "/api/billing/razorpay/webhook") return;
  // API-key clients are servers without cookies; the key authenticates them.
  if (req.headers.get("x-api-key")?.startsWith("hrms_")) return;
  // Native clients authenticate with an access bearer token and cannot be
  // targeted by browser cookie CSRF. Cookie-authenticated mutations still
  // require the configured web origin below.
  if (req.headers.get("authorization")?.match(/^Bearer\s+/i)) return;
  const origin = req.headers.get("origin");
  if (
    origin &&
    origin === new URL(process.env.APP_URL || "http://localhost:3000").origin
  )
    return;
  // A verified white-label domain is also a first-party origin.
  const { companyForHost } = await import("@/modules/saas/branding");
  let host: string | null = null;
  try {
    host = origin ? new URL(origin).host : null;
  } catch {
    host = null;
  }
  if (!host || !(await companyForHost(host)))
    throw new AppError(403, "Request origin is not allowed.", "CSRF_REJECTED");
}
export async function json(
  req: NextRequest,
  maxBytes = 65536,
): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new AppError(415, "Use application/json.", "UNSUPPORTED_MEDIA_TYPE");
  const reader = req.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (!reader) throw new AppError(400, "Request body is required.");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new AppError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid JSON.");
  }
}
export async function authenticate(req: NextRequest): Promise<Context> {
  const bearer = req.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || req.cookies.get("hrms_access")?.value;
  if (!token) throw new AppError(401, "Please sign in.", "UNAUTHENTICATED");
  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw new AppError(401, "Your session expired.", "UNAUTHENTICATED");
  }
  const session = await db.session.findUnique({
    where: { id: payload.sessionId },
    include: {
      user: {
        include: {
          role: { include: { permissions: true } },
          company: { select: { status: true } },
        },
      },
    },
  });
  if (
    !session ||
    session.userId !== payload.userId ||
    session.expiresAt < new Date() ||
    !session.user.active
  )
    throw new AppError(401, "Your session expired.", "UNAUTHENTICATED");
  const u = session.user;
  if (u.company.status === "SUSPENDED" && !u.isSuperAdmin)
    throw new AppError(
      403,
      "This company account is suspended. Contact your service provider.",
      "COMPANY_SUSPENDED",
    );
  const now = Date.now();
  const policy = await securityPolicy(u.companyId);
  if (
    policy.sessionIdleMinutes &&
    now - session.lastUsedAt.getTime() > policy.sessionIdleMinutes * 60000
  ) {
    await db.session.deleteMany({ where: { id: session.id } });
    throw new AppError(
      401,
      "Your session ended after a period of inactivity.",
      "UNAUTHENTICATED",
    );
  }
  if (now - session.lastUsedAt.getTime() > 60000)
    await db.session.updateMany({
      where: { id: session.id },
      data: { lastUsedAt: new Date(now) },
    });
  const permissions = effectivePermissions(
    { roleName: u.role.name, isSuperAdmin: u.isSuperAdmin },
    u.role.permissions.map((p) => p.permissionKey),
  );
  const gate = securityGate(policy, u, roleTier(permissions, u.isSuperAdmin));
  const route = req.nextUrl.pathname;
  // Setup routes stay reachable while a required setup step is pending.
  const setupRoutes = [
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/password",
    "/api/auth/2fa/status",
    "/api/auth/2fa/setup",
    "/api/auth/2fa/enable",
    "/api/auth/recovery-codes",
    "/api/face/status",
    "/api/face/enroll",
    "/api/v1/face/status",
    "/api/v1/face/enroll",
  ];
  if (!setupRoutes.includes(route)) {
    if (gate.passwordChangeRequired)
      throw new AppError(
        428,
        gate.temporaryPassword
          ? "Choose your own password to continue."
          : "Your password has expired. Change it to continue.",
        "PASSWORD_EXPIRED",
      );
    if (gate.mfaSetupRequired)
      throw new AppError(
        428,
        "Your company requires two-factor authentication. Set it up to continue.",
        "MFA_SETUP_REQUIRED",
      );
  }
  return {
    userId: u.id,
    companyId: u.companyId,
    name: u.name,
    roleId: u.roleId,
    roleName: u.role.name,
    isSuperAdmin: u.isSuperAdmin,
    permissions,
    sessionId: session.id,
    ...gate,
  };
}
export function requirePermission(ctx: Context, permission: PermissionKey) {
  if (!ctx.permissions.includes(permission))
    throw new AppError(
      403,
      "You do not have permission for this action.",
      "FORBIDDEN",
    );
}
export async function audit(
  tx: Prisma.TransactionClient,
  ctx: Pick<Context, "companyId" | "userId" | "name">,
  action: string,
  module: string,
  recordId?: string,
  oldValue?: Prisma.InputJsonValue,
  newValue?: Prisma.InputJsonValue,
  requestIp?: string,
) {
  await tx.auditLog.create({
    data: {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorName: ctx.name,
      action,
      module,
      recordId,
      oldValue,
      newValue,
      ip: requestIp,
    },
  });
}
export async function provisionCompany(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof companySchema>,
) {
  const company = await tx.company.create({ data: input });
  for (const [key, description] of Object.entries(permissions))
    await tx.permission.upsert({
      where: { key },
      create: { key, description },
      update: { description },
    });
  for (const name of roleNames)
    await tx.role.create({
      data: {
        companyId: company.id,
        name,
        system: true,
        permissions: {
          create: defaultGrants[name].map((permissionKey) => ({
            permissionKey,
          })),
        },
      },
    });
  await tx.department.createMany({
    data: ["HR", "IT", "Finance", "Sales", "Operations"].map((name) => ({
      companyId: company.id,
      name,
    })),
  });
  await tx.designation.createMany({
    data: [
      "HR Manager",
      "Software Developer",
      "Accountant",
      "Sales Executive",
      "IT Executive",
    ].map((name) => ({ companyId: company.id, name })),
  });
  await tx.branch.create({
    data: { companyId: company.id, name: "Head office" },
  });
  const { provisionSubscription } = await import("@/modules/saas/service");
  await provisionSubscription(tx, company.id);
  return company;
}
export async function issueSession(
  user: { id: string; name: string; companyId: string },
  req: NextRequest,
) {
  const session = await db.session.create({
    data: {
      userId: user.id,
      refreshHash: digest(randomBytes(32).toString("hex")),
      expiresAt: new Date(Date.now() + 7 * 86400000),
      ip: ip(req),
      userAgent: req.headers.get("user-agent")?.slice(0, 500),
    },
  });
  const [access, refresh] = await Promise.all([
    signToken(user.id, session.id),
    signToken(user.id, session.id, true),
  ]);
  await db.session.update({
    where: { id: session.id },
    data: { refreshHash: digest(refresh) },
  });
  const response = NextResponse.json({
    success: true,
    data: { name: user.name },
  });
  setCookies(response, access, refresh);
  return response;
}
function setCookies(response: NextResponse, access: string, refresh: string) {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  response.cookies.set("hrms_access", access, { ...opts, maxAge: 900 });
  response.cookies.set("hrms_refresh", refresh, { ...opts, maxAge: 7 * 86400 });
}
export async function setup(req: NextRequest) {
  await rateLimit(`setup:${ip(req)}`, 10);
  const b = setupSchema.parse(await json(req));
  const expected = process.env.SETUP_TOKEN;
  if (
    !expected ||
    !timingSafeEqual(
      Buffer.from(digest(b.setupToken)),
      Buffer.from(digest(expected)),
    )
  )
    throw new AppError(
      403,
      "Invalid setup token. Read SETUP_TOKEN from your local .env file.",
      "SETUP_TOKEN_INVALID",
    );
  const passwordHash = await bcrypt.hash(b.password, 12);
  const user = await db.$transaction(
    async (tx) => {
      if (
        (await tx.setupState.findUnique({ where: { id: 1 } })) ||
        (await tx.user.count())
      )
        throw new AppError(409, "Setup has already been completed.");
      await tx.setupState.create({ data: { id: 1 } });
      const company = await provisionCompany(tx, b.company);
      const role = await tx.role.findUniqueOrThrow({
        where: {
          companyId_name: { companyId: company.id, name: "Super Admin" },
        },
      });
      const u = await tx.user.create({
        data: {
          companyId: company.id,
          roleId: role.id,
          name: b.name,
          email: b.email,
          passwordHash,
          isSuperAdmin: true,
        },
      });
      await audit(
        tx,
        { companyId: company.id, userId: u.id, name: u.name },
        "SETUP_COMPLETE",
        "company",
        company.id,
        undefined,
        { name: company.name },
        ip(req),
      );
      return u;
    },
    { timeout: 20000 },
  );
  return issueSession(user, req);
}
// Shared by web and mobile sign-in: lockout, second factor and login history.
async function verifyCredentials(
  req: NextRequest,
  b: z.infer<typeof loginSchema>,
  channel: "WEB" | "MOBILE",
) {
  await rateLimit(
    `login-account:${digest(`${b.companyCode.toUpperCase()}:${b.identifier.toLowerCase()}`)}`,
    10,
  );
  const company = await db.company.findUnique({
    where: { code: b.companyCode.toUpperCase() },
  });
  const user = company
    ? await db.user.findFirst({
        where: {
          companyId: company.id,
          OR: [
            { email: b.identifier.toLowerCase() },
            { mobile: b.identifier },
            {
              employee: {
                employeeCode: { equals: b.identifier, mode: "insensitive" },
              },
            },
          ],
        },
      })
    : null;
  const history = (success: boolean, reason?: string) =>
    company
      ? recordLogin({
          companyId: company.id,
          userId: user?.id,
          channel,
          success,
          reason,
          req,
        })
      : undefined;
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await history(false, "LOCKED");
    throw new AppError(
      423,
      "This account is temporarily locked after repeated failed sign-ins. Try again later or ask an administrator to unlock it.",
      "ACCOUNT_LOCKED",
    );
  }
  const valid = await bcrypt.compare(
    b.password,
    user?.passwordHash ||
      "$2b$12$uZ8HYHOQSXdMn46BNPUPXuMIABCRHxFg8eTbsKtLzaOW.6PEgHqfC",
  );
  if (!user || !valid || !user.active) {
    if (company) {
      if (channel === "WEB")
        await audit(
          db,
          {
            companyId: company.id,
            userId: user?.id || "",
            name: "Authentication",
          },
          "LOGIN_FAILED",
          "auth",
          undefined,
          undefined,
          undefined,
          ip(req),
        );
      await history(
        false,
        !user ? "UNKNOWN_ACCOUNT" : !valid ? "INVALID_PASSWORD" : "INACTIVE",
      );
    }
    if (user && !valid) await registerFailure(user, req);
    throw new AppError(
      401,
      "Invalid company code or credentials.",
      "INVALID_CREDENTIALS",
    );
  }
  if (user.mustSetPassword)
    throw new AppError(
      428,
      channel === "WEB"
        ? "Password setup is required. Ask an administrator for a first-login reset code."
        : "Create your password at /employee-setup before using the mobile app.",
      "PASSWORD_SETUP_REQUIRED",
    );
  try {
    await checkSecondFactor(user, b.totp, b.recoveryCode, req);
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_TWO_FACTOR") {
      await history(false, "INVALID_SECOND_FACTOR");
      await registerFailure(user, req);
    }
    throw error;
  }
  if (company?.status === "SUSPENDED" && !user.isSuperAdmin) {
    await history(false, "COMPANY_SUSPENDED");
    throw new AppError(
      403,
      "This company account is suspended. Contact your service provider.",
      "COMPANY_SUSPENDED",
    );
  }
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await history(true);
  return user;
}
export async function login(req: NextRequest, owner = false) {
  await rateLimit(`login-ip:${ip(req)}`, 100);
  const input = await json(req);
  let b: z.infer<typeof loginSchema>;
  if (owner) {
    const credentials = loginSchema
      .omit({ companyCode: true })
      .extend({
        identifier: z.string().trim().email().toLowerCase(),
      })
      .parse(input);
    await rateLimit(`owner-login:${digest(credentials.identifier)}`, 10);
    const owners = await db.user.findMany({
      where: { email: credentials.identifier, isSuperAdmin: true },
      select: { company: { select: { code: true } } },
      take: 2,
    });
    if (owners.length !== 1) {
      await bcrypt.compare(
        credentials.password,
        "$2b$12$uZ8HYHOQSXdMn46BNPUPXuMIABCRHxFg8eTbsKtLzaOW.6PEgHqfC",
      );
      throw new AppError(
        401,
        "Invalid owner credentials.",
        "INVALID_CREDENTIALS",
      );
    }
    b = { ...credentials, companyCode: owners[0].company.code };
  } else {
    b = loginSchema.parse(input);
  }
  // On a company's own domain, only that company's users sign in.
  const { companyForHost } = await import("@/modules/saas/branding");
  const bound = await companyForHost(req.headers.get("host"));
  if (bound && bound.code !== b.companyCode.toUpperCase())
    throw new AppError(
      403,
      "Sign in to this company on its own address.",
      "WRONG_COMPANY_DOMAIN",
    );
  const user = await verifyCredentials(req, b, "WEB");
  if (owner && !user.isSuperAdmin)
    throw new AppError(
      401,
      "Invalid owner credentials.",
      "INVALID_CREDENTIALS",
    );
  await audit(
    db,
    { companyId: user.companyId, userId: user.id, name: user.name },
    "LOGIN",
    "auth",
    user.id,
    undefined,
    undefined,
    ip(req),
  );
  return issueSession(user, req);
}

export async function mobileLogin(req: NextRequest) {
  await rateLimit(`mobile-login-ip:${ip(req)}`, 100);
  const b = mobileLoginSchema.parse(await json(req));
  const user = await verifyCredentials(req, b, "MOBILE");
  const { requireFeature } = await import("@/modules/saas/service");
  await requireFeature(user.companyId, "mobile");
  const device = b.device
    ? await db.employeeDevice.findUnique({
        where: {
          companyId_userId_deviceId: {
            companyId: user.companyId,
            userId: user.id,
            deviceId: b.device.deviceId,
          },
        },
      })
    : null;
  if (device && !device.active)
    throw new AppError(
      403,
      "This device was deactivated by your administrator.",
      "DEVICE_DEACTIVATED",
    );
  const session = await db.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        userId: user.id,
        refreshHash: digest(randomBytes(32).toString("hex")),
        expiresAt: new Date(Date.now() + 7 * 86400000),
        ip: ip(req),
        userAgent: req.headers.get("user-agent")?.slice(0, 500),
      },
    });
    const registered = b.device
      ? await tx.employeeDevice.upsert({
          where: {
            companyId_userId_deviceId: {
              companyId: user.companyId,
              userId: user.id,
              deviceId: b.device.deviceId,
            },
          },
          create: { ...b.device, companyId: user.companyId, userId: user.id },
          update: { ...b.device, lastSeenAt: new Date() },
        })
      : null;
    await tx.mobileSession.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        sessionId: created.id,
        deviceId: registered?.id,
        platform: b.device?.platform,
        appVersion: b.device?.appVersion,
      },
    });
    return created;
  });
  const [accessToken, refreshToken] = await Promise.all([
    signToken(user.id, session.id),
    signToken(user.id, session.id, true),
  ]);
  await db.session.update({
    where: { id: session.id },
    data: { refreshHash: digest(refreshToken) },
  });
  await audit(
    db,
    { companyId: user.companyId, userId: user.id, name: user.name },
    "MOBILE_LOGIN",
    "auth",
    user.id,
    undefined,
    undefined,
    ip(req),
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: 900,
    user: {
      id: user.id,
      name: user.name,
      companyId: user.companyId,
      roleName: (
        await db.role.findUniqueOrThrow({
          where: { id: user.roleId },
          select: { name: true },
        })
      ).name,
    },
  };
}

export async function mobileRefresh(req: NextRequest) {
  await rateLimit(`mobile-refresh:${ip(req)}`, 200);
  const b = z
    .object({ refreshToken: z.string().min(20) })
    .strict()
    .parse(await json(req));
  let payload;
  try {
    payload = await verifyToken(b.refreshToken, true);
  } catch {
    throw new AppError(401, "Please sign in again.", "UNAUTHENTICATED");
  }
  const session = await db.session.findUnique({
    where: { id: payload.sessionId },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== payload.userId ||
    !session.user.active ||
    session.expiresAt < new Date() ||
    session.refreshHash !== digest(b.refreshToken)
  )
    throw new AppError(401, "Please sign in again.", "UNAUTHENTICATED");
  const [accessToken, refreshToken] = await Promise.all([
    signToken(session.userId, session.id),
    signToken(session.userId, session.id, true),
  ]);
  await db.session.update({
    where: { id: session.id },
    data: { refreshHash: digest(refreshToken), lastUsedAt: new Date() },
  });
  await db.mobileSession.updateMany({
    where: { sessionId: session.id },
    data: { lastSeenAt: new Date() },
  });
  return { accessToken, refreshToken, expiresIn: 900 };
}
export async function checkSecondFactor(
  user: {
    id: string;
    twoFactorEnabled: boolean;
    twoFactorSecret: string | null;
    lastTotpStep: bigint | null;
    companyId?: string;
  },
  code?: string,
  recoveryCode?: string,
  req?: NextRequest,
) {
  if (!user.twoFactorEnabled) return;
  if (recoveryCode && req && user.companyId)
    return consumeRecoveryCode(
      { id: user.id, companyId: user.companyId },
      recoveryCode,
      req,
    );
  if (!code || !user.twoFactorSecret)
    throw new AppError(
      401,
      "Enter your 6-digit authenticator code.",
      "TWO_FACTOR_REQUIRED",
    );
  const step = verifyTotp(
    decrypt(user.twoFactorSecret).secret,
    code,
    user.lastTotpStep,
  );
  if (step === null)
    throw new AppError(
      401,
      "Invalid or already used authenticator code.",
      "INVALID_TWO_FACTOR",
    );
  const result = await db.user.updateMany({
    where: {
      id: user.id,
      lastTotpStep: user.lastTotpStep,
      twoFactorEnabled: true,
    },
    data: { lastTotpStep: BigInt(step) },
  });
  if (result.count !== 1)
    throw new AppError(
      401,
      "Authenticator code was already used.",
      "INVALID_TWO_FACTOR",
    );
}
export async function refresh(req: NextRequest) {
  await rateLimit(`refresh:${ip(req)}`, 200);
  let payload;
  const token = req.cookies.get("hrms_refresh")?.value || "";
  try {
    payload = await verifyToken(token, true);
  } catch {
    throw new AppError(401, "Please sign in again.", "UNAUTHENTICATED");
  }
  const session = await db.session.findUnique({
    where: { id: payload.sessionId },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== payload.userId ||
    !session.user.active ||
    session.expiresAt < new Date()
  )
    throw new AppError(401, "Please sign in again.", "UNAUTHENTICATED");
  const [access, refreshToken] = await Promise.all([
    signToken(session.userId, session.id),
    signToken(session.userId, session.id, true),
  ]);
  const changed = await db.session.updateMany({
    where: {
      id: session.id,
      refreshHash: digest(token),
      expiresAt: { gt: new Date() },
    },
    data: { refreshHash: digest(refreshToken), lastUsedAt: new Date() },
  });
  if (changed.count !== 1)
    throw new AppError(
      401,
      "Refresh token is no longer valid.",
      "UNAUTHENTICATED",
    );
  const response = NextResponse.json({ success: true });
  setCookies(response, access, refreshToken);
  return response;
}
export async function logout(req: NextRequest) {
  // Logout also works after access-token expiry.
  const token = req.cookies.get("hrms_refresh")?.value;
  if (token) {
    try {
      const p = await verifyToken(token, true);
      const s = await db.session.findFirst({
        where: {
          id: p.sessionId,
          userId: p.userId,
          refreshHash: digest(token),
        },
        include: { user: true },
      });
      if (s) {
        await db.$transaction(async (tx) => {
          await tx.session.deleteMany({ where: { id: s.id } });
          await audit(
            tx,
            {
              companyId: s.user.companyId,
              userId: s.userId,
              name: s.user.name,
            },
            "LOGOUT",
            "auth",
            s.id,
            undefined,
            undefined,
            ip(req),
          );
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) throw error;
    }
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set("hrms_access", "", { path: "/", maxAge: 0 });
  response.cookies.set("hrms_refresh", "", { path: "/", maxAge: 0 });
  return response;
}
