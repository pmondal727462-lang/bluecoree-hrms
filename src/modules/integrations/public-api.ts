import { NextRequest } from "next/server";
import { z } from "zod";
import { db, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { digest } from "@/lib/crypto";
import { ip, rateLimit } from "@/modules/auth/service";
import { journal, type apiScopes } from "./service";
import type { Context } from "@/modules/auth/service";
import { saveEmployee } from "@/modules/employees/service";
import { timeRoute } from "@/modules/time/service";
import { consumeQuota, requireFeature } from "@/modules/saas/service";

type Scope = (typeof apiScopes)[number];
type ApiKeyContext = {
  id: string;
  companyId: string;
  scopes: string[];
  name: string;
  createdBy: string;
};
// Writes run through the same module code as the web app, as a restricted
// context attributed to the user who created the key.
function apiContext(key: ApiKeyContext, permissions: string[]): Context {
  return {
    userId: key.createdBy,
    companyId: key.companyId,
    name: `API key: ${key.name}`,
    roleId: "",
    roleName: "API",
    isSuperAdmin: false,
    permissions,
    sessionId: `api:${key.id}`,
  };
}
async function write(
  req: NextRequest,
  key: ApiKeyContext,
  resource: string,
  id?: string,
) {
  if (
    resource === "employees" &&
    (req.method === "POST" || (id && req.method === "PUT"))
  ) {
    need(key, "employees.write");
    return saveEmployee(
      req,
      apiContext(key, [
        "employees.read",
        "employees.write",
        "organization.read",
      ]),
      id,
    );
  }
  if (resource === "attendance" && !id && req.method === "POST") {
    need(key, "attendance.write");
    return timeRoute(
      req,
      apiContext(key, ["attendance.read", "attendance.manage"]),
      ["time", "attendance"],
    );
  }
  if (resource === "leave" && id && req.method === "PUT") {
    need(key, "leave.write");
    return timeRoute(
      req,
      apiContext(key, ["timeoff.manage", "attendance.read"]),
      ["time", "leave", id],
    );
  }
  throw new AppError(
    405,
    "This public API endpoint does not accept that method.",
  );
}

export function apiKeyFrom(req: NextRequest) {
  const header =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.match(/^Bearer\s+(hrms_\S+)$/i)?.[1];
  return header?.startsWith("hrms_") ? header : null;
}
async function authenticateKey(key: string): Promise<ApiKeyContext> {
  const found = await db.apiKey.findUnique({
    where: { keyHash: digest(key) },
    include: { company: { select: { status: true } } },
  });
  if (
    !found ||
    found.company.status === "SUSPENDED" ||
    found.revokedAt ||
    (found.expiresAt && found.expiresAt < new Date())
  )
    throw new AppError(401, "Invalid or revoked API key.", "INVALID_API_KEY");
  await rateLimit(`api-key:${found.id}`, 1000);
  await db.apiKey.update({
    where: { id: found.id },
    data: { lastUsedAt: new Date() },
  });
  return found;
}
function need(key: ApiKeyContext, scope: Scope) {
  if (!key.scopes.includes(scope))
    throw new AppError(
      403,
      `This API key lacks the ${scope} scope.`,
      "FORBIDDEN",
    );
}
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  updatedSince: z.iso.datetime({ offset: true }).optional(),
  status: z.string().max(40).optional(),
});
const range = (from?: string, to?: string) =>
  from || to
    ? {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      }
    : undefined;

async function handle(
  req: NextRequest,
  key: ApiKeyContext,
  resource: string,
  id?: string,
) {
  if (req.method !== "GET") return write(req, key, resource, id);
  if (id)
    throw new AppError(404, "Public API endpoint not found.", "NOT_FOUND");
  const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const paging = { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
  const companyId = key.companyId;
  if (resource === "employees") {
    need(key, "employees.read");
    const where = {
      companyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.updatedSince
        ? { updatedAt: { gte: new Date(q.updatedSince) } }
        : {}),
    };
    const [items, total] = await db.$transaction([
      // Only work-profile fields are exposed; identity and bank data never are.
      db.employee.findMany({
        where,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          middleName: true,
          lastName: true,
          officialEmail: true,
          status: true,
          employmentType: true,
          joinedAt: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
          branch: { select: { name: true } },
          updatedAt: true,
        },
        orderBy: { employeeCode: "asc" },
        ...paging,
      }),
      db.employee.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "attendance") {
    need(key, "attendance.read");
    const where = { companyId, workDate: range(q.from, q.to) };
    const [items, total] = await db.$transaction([
      db.attendance.findMany({
        where,
        select: {
          id: true,
          workDate: true,
          checkIn: true,
          checkOut: true,
          workedMinutes: true,
          lateMinutes: true,
          overtimeMinutes: true,
          shiftName: true,
          source: true,
          employee: { select: { id: true, employeeCode: true } },
        },
        orderBy: [{ workDate: "desc" }, { id: "asc" }],
        ...paging,
      }),
      db.attendance.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "leave") {
    need(key, "leave.read");
    const where = {
      companyId,
      startDate: range(q.from, q.to),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await db.$transaction([
      db.leaveRequest.findMany({
        where,
        select: {
          id: true,
          startDate: true,
          endDate: true,
          days: true,
          status: true,
          reviewedAt: true,
          leaveType: { select: { name: true, paid: true } },
          employee: { select: { id: true, employeeCode: true } },
        },
        orderBy: [{ startDate: "desc" }, { id: "asc" }],
        ...paging,
      }),
      db.leaveRequest.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  if (resource === "payroll" || resource === "payslips") {
    need(key, "payroll.read");
    const where = { companyId, periodEnd: range(q.from, q.to) };
    const [items, total] = await db.$transaction([
      db.payslip.findMany({
        where,
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          grossPay: true,
          deductions: true,
          netPay: true,
          currency: true,
          issuedAt: true,
          employee: { select: { id: true, employeeCode: true } },
        },
        orderBy: [{ periodEnd: "desc" }, { id: "asc" }],
        ...paging,
      }),
      db.payslip.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  // Payroll journal for accounting systems (spec §45).
  if (resource === "accounting-journal") {
    need(key, "payroll.read");
    if (!q.from || !q.to)
      throw new AppError(422, "Give from and to dates (YYYY-MM-DD).");
    return journal(apiContext(key, ["payroll.read"]), q.from, q.to);
  }
  throw new AppError(404, "Public API endpoint not found.", "NOT_FOUND");
}

export async function publicApi(
  req: NextRequest,
  apiKey: string,
  resource: string,
  id?: string,
) {
  const started = Date.now();
  let key: ApiKeyContext | null = null,
    status = 200;
  try {
    const k = (key = await authenticateKey(apiKey));
    // The key's company scopes every query after key lookup.
    return await withTenant(k.companyId, async () => {
      await requireFeature(k.companyId, "api");
      await consumeQuota(k.companyId, "api_calls");
      return handle(req, k, resource, id);
    });
  } catch (error) {
    status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : 500;
    throw error;
  } finally {
    if (key)
      await db.apiLog.create({
        data: {
          companyId: key.companyId,
          apiKeyId: key.id,
          method: req.method,
          path: req.nextUrl.pathname.slice(0, 200),
          status,
          durationMs: Date.now() - started,
          ip: ip(req),
        },
      });
  }
}
