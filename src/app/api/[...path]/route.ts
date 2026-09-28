import { NextRequest, NextResponse } from "next/server";
import { db, withSystem, withTenant } from "@/lib/db";
import { errorResponse, AppError, logger } from "@/lib/errors";
import {
  authenticate,
  csrf,
  setup,
  login,
  logout,
  refresh,
  requirePermission,
  mobileLogin,
  mobileRefresh,
} from "@/modules/auth/service";
import {
  listEmployees,
  getEmployee,
  exportEmployees,
  saveEmployee,
  archiveEmployee,
  profile,
} from "@/modules/employees/service";
import {
  company,
  companies,
  organization,
} from "@/modules/organization/service";
import {
  users,
  roles,
  sessions,
  resetEmployeePassword,
} from "@/modules/users/service";
import { dashboard } from "@/modules/dashboard/service";
import { paginationSchema } from "@/modules/shared/validators";
import { openapi } from "@/config/openapi";
import {
  passwordChange,
  twoFactor,
  requestChallenge,
  redeemChallenge,
  employeePasswordSetup,
} from "@/modules/auth/account";
import { emailConfigured } from "@/integrations/email";
import { timeRoute } from "@/modules/time/service";
import { aiRoute } from "@/modules/ai/service";
import { payrollRoute } from "@/modules/payroll/service";
import { payrollAdmin } from "@/modules/payroll/runs";
import { payslipPdf } from "@/modules/payroll/payslip-pdf";
import { pendingApprovals } from "@/modules/dashboard/approvals";
import { retentionRoute } from "@/modules/auth/retention";
import { billingRoute, razorpayWebhook } from "@/modules/saas/billing";
import {
  contactRoute,
  dismissSetup,
  setupProgress,
  signupRoute,
} from "@/modules/saas/signup";
import { careersRoute } from "@/modules/recruitment/careers";
import { offerPortal } from "@/modules/recruitment/offers";
import { trainingRoute } from "@/modules/training/service";
import { assetsRoute } from "@/modules/assets/service";
import { expensesRoute } from "@/modules/expenses/service";
import { recruitmentRoute } from "@/modules/recruitment/service";
import { performanceRoute } from "@/modules/performance/service";
import { reportsRoute } from "@/modules/reports/service";
import { adminDevices, mobileRoute } from "@/modules/mobile/service";
import { faceAdminRoute, faceRoute, faceStatus } from "@/modules/face/routes";
import { integrationsRoute } from "@/modules/integrations/service";
import { apiKeyFrom, publicApi } from "@/modules/integrations/public-api";
import { flushQueuedWebhooks } from "@/modules/integrations/outbound";
import { accountSecurity, securityRoute } from "@/modules/auth/security";
import { platformAccess, platformRoute } from "@/modules/platform/service";
import { settingsRoute } from "@/modules/organization/settings";
import { references } from "@/modules/organization/references";
import { lifecycleRoute } from "@/modules/employees/lifecycle";
import { employeePhoto } from "@/modules/employees/photo";
import {
  bankAccountsRoute,
  emergencyContactsRoute,
} from "@/modules/employees/contacts";
import { redeemSignedUrl } from "@/lib/storage";
import { documentsRoute } from "@/modules/documents/service";
import { celebrations } from "@/modules/dashboard/celebrations";
import { helpdeskRoute } from "@/modules/helpdesk/service";
import {
  onboardingPortal,
  onboardingRoute,
} from "@/modules/onboarding/service";
import { announcementsRoute } from "@/modules/announcements/service";
import {
  biometricRoute,
  genericPush,
  hikvisionPush,
} from "@/modules/biometric/service";
import { notificationsRoute } from "@/modules/notifications/service";
import { home } from "@/modules/dashboard/home";
import { recordServerError } from "@/modules/platform/health";
import { supportRoute } from "@/modules/support/service";
import {
  consumeQuota,
  requireFeature,
  subscriptionRoute,
  subscriptionSummary,
  publicPlans,
  type Feature,
} from "@/modules/saas/service";
import {
  brandingRoute,
  companyBranding,
  publicBrandingRoute,
  domainCheck,
} from "@/modules/saas/branding";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Unauthenticated routes and authentication itself use system scope; once a
// user is authenticated, all work runs in that company's tenant scope.
function handler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return withSystem(() => route(req, context));
}
async function route(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const started = Date.now();
  try {
    await csrf(req);
    const { path } = await params;
    const route = path.join("/");
    const method = req.method;
    const ok = (data: unknown, status = 200) =>
      NextResponse.json(
        { success: true, data },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    if (route === "health" && method === "GET") {
      await db.$queryRaw`SELECT 1`;
      return ok({ status: "ready" });
    }
    if (route === "docs" && method === "GET") return NextResponse.json(openapi);
    if (route === "auth/setup" && method === "GET")
      return ok({
        required:
          !(await db.setupState.findUnique({ where: { id: 1 } })) &&
          !(await db.user.count()),
      });
    if (route === "auth/setup" && method === "POST") return await setup(req);
    if (route === "auth/login" && method === "POST") return await login(req);
    if (route === "auth/owner-login" && method === "POST")
      return await login(req, true);
    if (route === "v1/auth/login" && method === "POST")
      return ok(await mobileLogin(req));
    if (route === "v1/auth/refresh" && method === "POST")
      return ok(await mobileRefresh(req));
    if (route === "auth/capabilities" && method === "GET")
      return ok({ email: emailConfigured() });
    if (route === "auth/forgot-password" && method === "POST")
      return ok(await requestChallenge(req, "reset"));
    if (route === "auth/reset-password" && method === "POST")
      return ok(await redeemChallenge(req, "reset"));
    if (route === "auth/employee-setup" && method === "POST")
      return ok(await employeePasswordSetup(req));
    if (route === "auth/otp/request" && method === "POST")
      return ok(await requestChallenge(req, "otp"));
    if (route === "auth/otp/verify" && method === "POST") {
      const result = await redeemChallenge(req, "otp");
      return result instanceof NextResponse ? result : ok(result);
    }
    if (route === "auth/refresh" && method === "POST")
      return await refresh(req);
    if (route === "auth/logout" && method === "POST") return await logout(req);
    // Short-lived signed download links for private files (local storage).
    if (path[0] === "files" && path.length === 2 && method === "GET") {
      const file = await redeemSignedUrl(path[1]);
      return new NextResponse(new Uint8Array(file.bytes), {
        headers: {
          "content-type": file.contentType,
          "content-disposition": file.disposition,
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "default-src none; img-src self; style-src unsafe-inline; sandbox",
          "cache-control": "private, no-store",
        },
      });
    }
    if (path[0] === "public" && path[1] === "signup") {
      const result = await signupRoute(req, path);
      return result instanceof NextResponse ? result : ok(result);
    }
    if (route === "public/domain-check" && method === "GET")
      return ok(await domainCheck(req));
    if (route === "public/contact" && method === "POST")
      return ok(await contactRoute(req));
    if (route === "public/plans" && method === "GET")
      return ok(await publicPlans());
    if (route === "billing/razorpay/webhook" && method === "POST")
      return ok(await razorpayWebhook(req));
    if (path[0] === "public" && path[1] === "careers" && path[2])
      return ok(await careersRoute(req, path));
    if (path[0] === "public" && path[1] === "offers" && path[2])
      return ok(await offerPortal(req, path[2]));
    if (path[0] === "public" && path[1] === "onboarding" && path[2])
      return ok(await onboardingPortal(req, path[2], path[4]));
    // Biometric device pushes authenticate with a device token, not a session.
    if (route === "biometric/push" && method === "POST")
      return ok(await genericPush(req));
    if (
      path[0] === "biometric" &&
      path[1] === "hikvision" &&
      path.length === 3 &&
      method === "POST"
    )
      return ok(await hikvisionPush(req, path[2]));
    if (path[0] === "public" && path[1] === "branding") {
      const result = await publicBrandingRoute(req, path);
      return result instanceof NextResponse ? result : ok(result);
    }
    const apiKey =
      path[0] === "v1" && (path.length === 2 || path.length === 3)
        ? apiKeyFrom(req)
        : null;
    if (apiKey) return ok(await publicApi(req, apiKey, path[1], path[2]));
    const ctx = await authenticate(req);
    return await withTenant(ctx.companyId, async () => {
      if (route === "celebrations") return ok(await celebrations(req, ctx));
      if (path[0] === "references" && path.length === 2 && method === "GET")
        return ok(await references(req, ctx, path[1]));
      // Paid modules are paused, not deleted, when the plan lacks them or expires.
      const moduleFeature: Record<string, Feature> = {
        ai: "ai",
        payroll: "payroll",
        time: path[1] === "import" ? "biometric" : "attendance",
        v1: "mobile",
        integrations: "api",
        dashboard: "reports",
        reports: "reports",
        recruitment: "recruitment",
        performance: "performance",
        training: "training",
        assets: "assets",
        expenses: "expenses",
        onboarding: "onboarding",
        biometric: "biometric",
      };
      const feature: Feature | null = moduleFeature[path[0]] ?? null;
      if (feature) await requireFeature(ctx.companyId, feature);
      if (
        path[0] === "ai" &&
        method === "POST" &&
        ["query", "generate"].includes(path[1])
      )
        await consumeQuota(ctx.companyId, "ai_requests");
      if (route === "subscription")
        return ok(await subscriptionRoute(req, ctx));
      if (route === "setup-progress" && method === "GET")
        return ok(await setupProgress(ctx));
      if (route === "setup-progress/dismiss" && method === "POST")
        return ok(await dismissSetup(ctx));
      if (path[0] === "subscription") {
        const result = await billingRoute(req, ctx, path);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (path[0] === "support") {
        const result = await supportRoute(req, ctx, path);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (path[0] === "branding") {
        return ok(await brandingRoute(req, ctx, path));
      }
      if (path[0] === "face" && ["profiles", "logs"].includes(path[1]))
        return ok(await faceAdminRoute(req, ctx, path));
      if (path[0] === "face" && path.length === 2)
        return ok(await faceRoute(req, ctx, path[1]));
      if (path[0] === "v1") {
        const resource = path[1];
        const resourceFeature: Record<string, Feature> = {
          attendance: "attendance",
          leave: "attendance",
          "leave-balances": "attendance",
          "geofence-events": "attendance",
          "field-tracking": "attendance",
          payslips: "payroll",
        };
        if (resourceFeature[resource])
          await requireFeature(ctx.companyId, resourceFeature[resource]);
        if (resource === "face" && path.length === 3)
          return ok(await faceRoute(req, ctx, path[2]));
        if (resource === "profile" && method === "GET")
          return ok(await profile(req, ctx));
        if (resource === "attendance") {
          const timePath = ["check-in", "check-out", "face-punch"].includes(
            path[2],
          )
            ? ["time", path[2]]
            : ["time", "attendance"];
          return ok(await timeRoute(req, ctx, timePath));
        }
        if (resource === "leave")
          return ok(await timeRoute(req, ctx, ["time", "leave"]));
        if (resource === "geofence-events")
          return ok(await timeRoute(req, ctx, ["time", "geofence-events"]));
        if (resource === "leave-balances")
          return ok(await timeRoute(req, ctx, ["time", "balances"]));
        if (resource === "payslips")
          return ok(await payrollRoute(req, ctx, "payslips"));
        if (resource === "field-tracking")
          return ok(
            await timeRoute(req, ctx, [
              "time",
              "field-tracking",
              ...path.slice(2),
            ]),
          );
        if (resource === "devices" || resource === "push-token")
          return ok(await mobileRoute(req, ctx, resource));
        if (resource === "approvals" && method === "GET")
          return ok(await pendingApprovals(ctx));
        if (
          resource === "payslips" &&
          path[2] &&
          path[3] === "pdf" &&
          method === "GET"
        )
          return payslipPdf(ctx, path[2]);
        // Stable mobile aliases for the self-service modules; the same
        // permission and plan checks apply as on the web routes.
        const aliases: Record<
          string,
          [
            Feature | null,
            (r: NextRequest, c: typeof ctx, p: string[]) => Promise<unknown>,
          ]
        > = {
          home: [null, (_r, c) => home(c)],
          expenses: ["expenses", expensesRoute],
          documents: [null, documentsRoute],
          notifications: [null, notificationsRoute],
          helpdesk: [null, helpdeskRoute],
          announcements: [null, (r, c, p) => announcementsRoute(r, c, p[1])],
          training: ["training", trainingRoute],
          assets: ["assets", assetsRoute],
          performance: ["performance", performanceRoute],
        };
        if (aliases[resource]) {
          const [aliasFeature, handler] = aliases[resource];
          if (aliasFeature) await requireFeature(ctx.companyId, aliasFeature);
          const result = await handler(req, ctx, path.slice(1));
          return result instanceof NextResponse ? result : ok(result);
        }
        throw new AppError(404, "Mobile endpoint not found.", "NOT_FOUND");
      }
      if (path[0] === "ai") return ok(await aiRoute(req, ctx, path));
      if (path[0] === "integrations") {
        const result = await integrationsRoute(req, ctx, path);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (path[0] === "time") return ok(await timeRoute(req, ctx, path));
      const modules: Record<
        string,
        (r: NextRequest, c: typeof ctx, p: string[]) => Promise<unknown>
      > = {
        expenses: expensesRoute,
        documents: documentsRoute,
        helpdesk: helpdeskRoute,
        onboarding: onboardingRoute,
        notifications: notificationsRoute,
        announcements: (r, c, p) => announcementsRoute(r, c, p[1]),
        biometric: biometricRoute,
        home: (_r, c) => home(c),
        recruitment: recruitmentRoute,
        performance: performanceRoute,
        training: trainingRoute,
        assets: assetsRoute,
        reports: reportsRoute,
      };
      if (modules[path[0]]) {
        const result = await modules[path[0]](req, ctx, path);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (
        path[0] === "payroll" &&
        [
          "statutory",
          "statutory-rules",
          "structures",
          "runs",
          "loans",
        ].includes(path[1])
      ) {
        const result = await payrollAdmin(req, ctx, path);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (
        path[0] === "payroll" &&
        path[1] === "payslips" &&
        path[2] &&
        path[3] === "pdf" &&
        method === "GET"
      )
        return payslipPdf(ctx, path[2]);
      if (path[0] === "payroll" && (path.length === 1 || path.length === 2))
        return ok(await payrollRoute(req, ctx, path[1]));
      if (route === "auth/password" && method === "PUT")
        return ok(await passwordChange(req, ctx));
      if (
        path[0] === "auth" &&
        path[1] === "2fa" &&
        path.length === 3 &&
        ((path[2] === "status" && method === "GET") ||
          (["setup", "enable", "disable"].includes(path[2]) &&
            method === "POST"))
      )
        return ok(await twoFactor(req, ctx, path[2]));
      if (route === "auth/me" && method === "GET") {
        const c = await db.company.findUniqueOrThrow({
          where: { id: ctx.companyId },
          select: { id: true, name: true, code: true },
        });
        const [subscription, branding] = await Promise.all([
          subscriptionSummary(ctx.companyId),
          companyBranding(ctx.companyId),
        ]);
        return ok({
          ...ctx,
          company: c,
          subscription: subscription && {
            status: subscription.status,
            plan: subscription.plan,
            endsAt: subscription.endsAt,
            graceEndsAt: subscription.graceEndsAt,
          },
          branding,
          platformRole: await platformAccess(ctx),
          faceEnrollmentRequired: (await faceStatus(ctx.userId, ctx.companyId))
            .enrollmentRequired,
        });
      }
      if (
        path[0] === "auth" &&
        path[1] === "sessions" &&
        ((path.length === 2 && method === "GET") ||
          (path.length === 3 && method === "DELETE"))
      )
        return ok(await sessions(req, ctx, path[2]));
      if (
        path[0] === "devices" &&
        ((path.length === 1 && method === "GET") ||
          (path.length === 2 && ["PUT", "DELETE"].includes(method)))
      )
        return ok(await adminDevices(req, ctx, path[1]));
      if (
        [
          "auth/login-history",
          "auth/recovery-codes",
          "auth/sessions/revoke-all",
        ].includes(route)
      )
        return ok(await accountSecurity(req, ctx, path.at(-1)!));
      if (path[0] === "security" && path[1] === "retention")
        return ok(await retentionRoute(req, ctx, path));
      if (path[0] === "security")
        return ok(await securityRoute(req, ctx, path));
      if (path[0] === "platform") {
        const result = await platformRoute(req, ctx, path);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (route === "dashboard" && method === "GET")
        return ok(await dashboard(ctx));
      if (route === "profile" && ["GET", "PUT"].includes(method))
        return ok(await profile(req, ctx));
      if (path[0] === "company" && path[1] === "settings") {
        const result = await settingsRoute(req, ctx, path[2]);
        return result instanceof NextResponse ? result : ok(result);
      }
      if (route === "company" && ["GET", "PUT"].includes(method))
        return ok(await company(req, ctx));
      if (route === "companies" && ["GET", "POST"].includes(method))
        return ok(await companies(req, ctx), method === "POST" ? 201 : 200);
      if (
        path[0] === "profile" &&
        path[1] === "emergency-contacts" &&
        path.length <= 3
      )
        return ok(await emergencyContactsRoute(req, ctx, "me", path[2]));
      if (
        path[0] === "employees" &&
        path[2] === "emergency-contacts" &&
        path.length <= 4
      )
        return ok(await emergencyContactsRoute(req, ctx, path[1], path[3]));
      if (
        path[0] === "employees" &&
        path[2] === "bank-accounts" &&
        path.length === 3
      )
        return ok(await bankAccountsRoute(req, ctx, path[1]));
      if (
        (route === "profile/photo" ||
          (path[0] === "employees" &&
            path.length === 3 &&
            path[2] === "photo")) &&
        ["GET", "PUT", "DELETE"].includes(method)
      )
        return ok(
          await employeePhoto(req, ctx, path[0] === "profile" ? "me" : path[1]),
        );
      if (
        path[0] === "employees" &&
        path.length >= 3 &&
        ["history", "lifecycle", "settlement"].includes(path[2])
      )
        return ok(await lifecycleRoute(req, ctx, path[1], path[2], path[3]));
      if (path[0] === "employees") {
        if (path.length === 1 && method === "GET")
          return ok(await listEmployees(req, ctx));
        if (path.length === 1 && method === "POST")
          return ok(await saveEmployee(req, ctx), 201);
        if (path.length === 2 && path[1] === "export" && method === "GET")
          return await exportEmployees(req, ctx);
        if (path.length === 2 && method === "GET")
          return ok(await getEmployee(path[1], ctx));
        if (path.length === 2 && method === "PUT")
          return ok(await saveEmployee(req, ctx, path[1]));
        if (path.length === 2 && method === "DELETE")
          return ok(await archiveEmployee(req, ctx, path[1]));
      }
      if (
        ["departments", "designations", "branches"].includes(path[0]) &&
        ((path.length === 1 && ["GET", "POST"].includes(method)) ||
          (path.length === 2 && ["PUT", "DELETE"].includes(method)))
      )
        return ok(await organization(req, ctx, path[0], path[1]));
      if (
        path[0] === "users" &&
        ((path.length === 1 && ["GET", "POST"].includes(method)) ||
          (path.length === 2 && method === "PUT"))
      )
        return ok(await users(req, ctx, path[1]));
      if (
        path[0] === "users" &&
        path[2] === "password-reset" &&
        method === "POST"
      )
        return ok(await resetEmployeePassword(req, ctx, path[1]));
      if (
        path[0] === "roles" &&
        ((path.length === 1 && ["GET", "POST"].includes(method)) ||
          (path.length === 2 && method === "PUT"))
      )
        return ok(await roles(req, ctx, path[1]));
      if (route === "audit" && method === "GET") {
        requirePermission(ctx, "audit.read");
        const { page, pageSize, search } = paginationSchema.parse(
          Object.fromEntries(req.nextUrl.searchParams),
        );
        const where = {
          companyId: ctx.companyId,
          ...(search
            ? {
                OR: [
                  {
                    action: { contains: search, mode: "insensitive" as const },
                  },
                  {
                    module: { contains: search, mode: "insensitive" as const },
                  },
                  {
                    actorName: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              }
            : {}),
        };
        const [items, total] = await db.$transaction([
          db.auditLog.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: "desc" },
          }),
          db.auditLog.count({ where }),
        ]);
        return ok({ items, total, page, pageSize });
      }
      throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
    });
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 500) await recordServerError(req.nextUrl.pathname);
    return response;
  } finally {
    flushQueuedWebhooks();
    logger.info(
      {
        method: req.method,
        path: req.nextUrl.pathname,
        durationMs: Date.now() - started,
      },
      "API request",
    );
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
