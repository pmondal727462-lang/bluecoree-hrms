import { Prisma } from "@prisma/client";
import { protectedRoles } from "@/config/permissions";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { exportFormats, exportTable } from "@/lib/export";
import { z } from "zod";
import { encrypt, decrypt } from "@/lib/crypto";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import {
  employeeSchema,
  paginationSchema,
  profileSchema,
} from "@/modules/shared/validators";

const include = {
  department: true,
  designation: true,
  branch: true,
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { id: true, name: true, email: true, active: true } },
  ...personalInclude,
} satisfies Prisma.EmployeeInclude;
type EmployeeRecord = Prisma.EmployeeGetPayload<{ include: typeof include }>;
export function serializeEmployee(
  record: EmployeeRecord,
  ctx: Context,
  own = false,
) {
  const {
    sensitiveEncrypted,
    photoKey,
    photoType: _type,
    photoSize: _size,
    addresses: _addresses,
    emergencyContacts: _contacts,
    bankAccounts: _banks,
    ...safe
  } = record;
  // The salary account comes from employee_bank_accounts; records saved
  // before that table existed may still hold it in the encrypted blob.
  const bank = primaryBank(record);
  const sensitive =
    !own && ctx.permissions.includes("employees.sensitive")
      ? {
          ...(sensitiveEncrypted ? decrypt(sensitiveEncrypted) : {}),
          ...(bank
            ? {
                bankAccount: decrypt(bank.accountEncrypted).accountNumber,
                ifsc: bank.ifsc,
              }
            : {}),
        }
      : null;
  return {
    ...safe,
    address: addressView(record),
    emergencyContact: emergencyView(record),
    emergencyContacts: contactList(record),
    hasPhoto: !!photoKey,
    ...(sensitive && Object.keys(sensitive).length ? { sensitive } : {}),
  };
}
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { enforceLimit } from "@/modules/saas/service";
import { recordChanges, recordHistory } from "./lifecycle";
import {
  addressView,
  contactList,
  emergencyView,
  personalInclude,
  primaryBank,
  writeAddress,
  writePrimaryBank,
  writePrimaryContact,
} from "./contacts";
// Directory filters shared by the list and the export.
function directoryWhere(
  ctx: Context,
  q: URLSearchParams,
  search: string,
): Prisma.EmployeeWhereInput {
  return {
    companyId: ctx.companyId,
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { employeeCode: { contains: search, mode: "insensitive" } },
            { officialEmail: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(q.get("departmentId") ? { departmentId: q.get("departmentId")! } : {}),
    ...(q.get("branchId") ? { branchId: q.get("branchId")! } : {}),
    ...(q.get("status") ? { status: q.get("status")! } : {}),
  };
}
export async function listEmployees(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "employees.read");
  const q = req.nextUrl.searchParams;
  const { page, pageSize, search } = paginationSchema.parse(
    Object.fromEntries(q),
  );
  const where = directoryWhere(ctx, q, search);
  const [items, total] = await db.$transaction([
    db.employee.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.employee.count({ where }),
  ]);
  return {
    items: items.map((e) => serializeEmployee(e, ctx)),
    total,
    page,
    pageSize,
  };
}
async function referenceChecks(
  tx: Prisma.TransactionClient,
  ctx: Context,
  b: Record<string, unknown>,
  id?: string,
) {
  const refs = [
    ["departmentId", tx.department],
    ["designationId", tx.designation],
    ["branchId", tx.branch],
    ["userId", tx.user],
    ["managerId", tx.employee],
  ] as const;
  for (const [field, model] of refs) {
    const value = b[field];
    if (value) {
      const count = await (model as typeof tx.department).count({
        where: { id: String(value), companyId: ctx.companyId },
      });
      if (!count) throw new AppError(422, `Invalid ${field}.`);
    }
  }
  if (b.managerId) {
    let current = String(b.managerId);
    const visited = new Set<string>();
    while (current) {
      if (current === id || visited.has(current))
        throw new AppError(
          422,
          "Reporting relationships cannot contain cycles.",
        );
      visited.add(current);
      const e = await tx.employee.findFirst({
        where: { id: current, companyId: ctx.companyId },
        select: { managerId: true },
      });
      current = e?.managerId || "";
    }
  }
}
export async function getEmployee(id: string, ctx: Context) {
  requirePermission(ctx, "employees.read");
  const employee = await db.employee.findFirst({
    where: { id, companyId: ctx.companyId },
    include,
  });
  if (!employee) throw new AppError(404, "Employee not found.", "NOT_FOUND");
  return serializeEmployee(employee, ctx);
}
export async function saveEmployee(
  req: NextRequest,
  ctx: Context,
  id?: string,
) {
  requirePermission(ctx, "employees.write");
  const b = id
    ? employeeSchema
        .partial()
        .strict()
        .parse(await json(req))
    : employeeSchema.parse(await json(req));
  if (b.sensitive) requirePermission(ctx, "employees.sensitive");
  const {
    sensitive,
    address,
    emergencyContact,
    joinedAt,
    dateOfBirth,
    confirmationDate,
    ...rest
  } = b;
  // Bank details are stored in employee_bank_accounts, not the identity blob.
  const { bankAccount, ifsc, ...identity } = sensitive ?? {};
  const bankGiven =
    !!sensitive && ("bankAccount" in sensitive || "ifsc" in sensitive);
  const data = {
    ...rest,
    ...(joinedAt ? { joinedAt: new Date(joinedAt) } : {}),
    ...(dateOfBirth !== undefined
      ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }
      : {}),
    ...(confirmationDate !== undefined
      ? {
          confirmationDate: confirmationDate
            ? new Date(confirmationDate)
            : null,
        }
      : {}),
    ...(sensitive ? { sensitiveEncrypted: encrypt(identity) } : {}),
  };
  return db.$transaction(
    async (tx) => {
      const old = id
        ? await tx.employee.findFirst({
            where: { id, companyId: ctx.companyId },
          })
        : null;
      if (id && !old)
        throw new AppError(404, "Employee not found.", "NOT_FOUND");
      await referenceChecks(tx, ctx, b, id);
      const linkedUserId = b.userId !== undefined ? b.userId : old?.userId;
      if ((b.status || old?.status) === "Inactive" && linkedUserId) {
        const linked = await tx.user.findUniqueOrThrow({
          where: { id: linkedUserId },
          include: { role: true },
        });
        if (
          linked.id === ctx.userId ||
          linked.isSuperAdmin ||
          protectedRoles.includes(linked.role.name)
        )
          throw new AppError(
            409,
            "Reassign the administrator account before marking this employee inactive.",
          );
        await tx.user.update({
          where: { id: linkedUserId },
          data: { active: false },
        });
        await tx.session.deleteMany({ where: { userId: linkedUserId } });
      }
      const saved = id
        ? await tx.employee.update({
            where: { id_companyId: { id, companyId: ctx.companyId } },
            data,
            include,
          })
        : await tx.employee.create({
            data: {
              ...data,
              companyId: ctx.companyId,
            } as Prisma.EmployeeUncheckedCreateInput,
            include,
          });
      // Audit only employment fields; never copy PII or ciphertext into the log.
      const snapshot = (e: typeof saved) => ({
        employeeCode: e.employeeCode,
        status: e.status,
        departmentId: e.departmentId,
        designationId: e.designationId,
        managerId: e.managerId,
        userId: e.userId,
      });
      if (address) await writeAddress(tx, ctx.companyId, saved.id, address);
      if (emergencyContact)
        await writePrimaryContact(
          tx,
          ctx.companyId,
          saved.id,
          emergencyContact,
        );
      if (bankGiven)
        await writePrimaryBank(tx, ctx, saved.id, {
          accountNumber: bankAccount,
          ifsc,
        });
      if (saved.status !== "Inactive")
        await enforceLimit(tx, ctx.companyId, "employees");
      await recordChanges(tx, ctx, old, saved);
      await enqueueWebhook(
        tx,
        ctx.companyId,
        id ? "employee.updated" : "employee.created",
        { id: saved.id, ...snapshot(saved) },
      );
      await audit(
        tx,
        ctx,
        id ? "UPDATE" : "CREATE",
        "employees",
        saved.id,
        old
          ? {
              employeeCode: old.employeeCode,
              status: old.status,
              departmentId: old.departmentId,
              designationId: old.designationId,
              managerId: old.managerId,
              userId: old.userId,
            }
          : undefined,
        {
          ...snapshot(saved),
          fields: Object.keys(b),
          sensitiveChanged: !!sensitive,
        },
        ip(req),
      );
      return serializeEmployee(
        await tx.employee.findUniqueOrThrow({
          where: { id_companyId: { id: saved.id, companyId: ctx.companyId } },
          include,
        }),
        ctx,
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function archiveEmployee(
  req: NextRequest,
  ctx: Context,
  id: string,
) {
  requirePermission(ctx, "employees.write");
  return db.$transaction(async (tx) => {
    const old = await tx.employee.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!old) throw new AppError(404, "Employee not found.", "NOT_FOUND");
    if (old.userId === ctx.userId)
      throw new AppError(409, "You cannot archive your own account.");
    if (old.userId) {
      const user = await tx.user.findUnique({
        where: { id: old.userId },
        include: { role: true },
      });
      if (user?.isSuperAdmin || protectedRoles.includes(user?.role.name ?? ""))
        throw new AppError(
          409,
          "Reassign the administrator account before archiving this employee.",
        );
      await tx.user.update({
        where: { id: old.userId },
        data: { active: false },
      });
      await tx.session.deleteMany({ where: { userId: old.userId } });
    }
    await tx.employee.update({
      where: { id_companyId: { id, companyId: ctx.companyId } },
      data: { status: "Inactive" },
    });
    await recordHistory(
      tx,
      ctx,
      id,
      "STATUS_CHANGE",
      new Date(new Date().toISOString().slice(0, 10)),
      { status: old.status },
      { status: "Inactive" },
      "Archived",
    );
    await enqueueWebhook(tx, ctx.companyId, "employee.deleted", {
      id,
      employeeCode: old.employeeCode,
      status: "Inactive",
    });
    await audit(
      tx,
      ctx,
      "ARCHIVE",
      "employees",
      id,
      { status: old.status },
      { status: "Inactive" },
      ip(req),
    );
    return { archived: true };
  });
}
export async function profile(req: NextRequest, ctx: Context) {
  requirePermission(
    ctx,
    req.method === "GET" ? "profile.read" : "profile.write",
  );
  const employee = await db.employee.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    include,
  });
  if (!employee) return null;
  if (req.method === "GET") return serializeEmployee(employee, ctx, true);
  const b = profileSchema.parse(await json(req));
  const { address, emergencyContact, ...fields } = b;
  return db.$transaction(async (tx) => {
    if (address) await writeAddress(tx, ctx.companyId, employee.id, address);
    if (emergencyContact)
      await writePrimaryContact(
        tx,
        ctx.companyId,
        employee.id,
        emergencyContact,
      );
    const saved = await tx.employee.update({
      where: { id_companyId: { id: employee.id, companyId: ctx.companyId } },
      data: fields,
      include,
    });
    await enqueueWebhook(tx, ctx.companyId, "employee.updated", {
      id: employee.id,
      employeeCode: saved.employeeCode,
      fields: Object.keys(b),
    });
    await audit(
      tx,
      ctx,
      "SELF_UPDATE",
      "employees",
      employee.id,
      undefined,
      { fields: Object.keys(b) },
      ip(req),
    );
    return serializeEmployee(saved, ctx, true);
  });
}

const exportLimit = 50000;
// Exports the filtered directory (all pages). Identity, bank and other
// encrypted fields are never included; the export is audited.
export async function exportEmployees(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "employees.read");
  const q = req.nextUrl.searchParams;
  const format = z.enum(exportFormats).parse(q.get("format") ?? "csv");
  const search = z
    .string()
    .max(150)
    .parse(q.get("search") ?? "");
  const rows = await db.employee.findMany({
    where: directoryWhere(ctx, q, search),
    select: {
      employeeCode: true,
      firstName: true,
      middleName: true,
      lastName: true,
      officialEmail: true,
      mobile: true,
      status: true,
      employmentType: true,
      joinedAt: true,
      confirmationDate: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      branch: { select: { name: true } },
      manager: {
        select: { employeeCode: true, firstName: true, lastName: true },
      },
    },
    orderBy: [{ employeeCode: "asc" }, { id: "asc" }],
    take: exportLimit + 1,
  });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const included = rows.slice(0, exportLimit);
  await db.auditLog.create({
    data: {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorName: ctx.name,
      action: "EXPORT",
      module: "employees",
      newValue: {
        format,
        rows: included.length,
        search,
        filters: Object.fromEntries(q),
      },
      ip: ip(req),
    },
  });
  return exportTable(
    {
      title: "Employees",
      columns: [
        { key: "employeeCode", label: "Employee code" },
        { key: "name", label: "Name" },
        { key: "officialEmail", label: "Official email" },
        { key: "mobile", label: "Mobile" },
        { key: "department", label: "Department" },
        { key: "designation", label: "Designation" },
        { key: "branch", label: "Branch" },
        { key: "manager", label: "Manager" },
        { key: "employmentType", label: "Employment type" },
        { key: "status", label: "Status" },
        { key: "joinedAt", label: "Joining date" },
        { key: "confirmationDate", label: "Confirmation date" },
      ],
      rows: included.map((e) => ({
        employeeCode: e.employeeCode,
        name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" "),
        officialEmail: e.officialEmail,
        mobile: e.mobile,
        department: e.department?.name ?? null,
        designation: e.designation?.name ?? null,
        branch: e.branch?.name ?? null,
        manager: e.manager
          ? `${e.manager.employeeCode} ${e.manager.firstName} ${e.manager.lastName}`
          : null,
        employmentType: e.employmentType,
        status: e.status,
        joinedAt: day(e.joinedAt),
        confirmationDate: day(e.confirmationDate),
      })),
      truncated: rows.length > exportLimit,
    },
    format,
  );
}
