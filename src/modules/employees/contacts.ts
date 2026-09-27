import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  audit,
  ip,
  json,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { linkedEmployee } from "@/modules/shared/team";

type Tx = Prisma.TransactionClient;
type Address = {
  current?: string | null;
  permanent?: string | null;
  city?: string | null;
  state?: string | null;
  pin?: string | null;
  country?: string | null;
};
type Emergency = {
  name?: string | null;
  relationship?: string | null;
  phone?: string | null;
};

// Loaded with every employee record that is serialized.
export const personalInclude = {
  addresses: true,
  emergencyContacts: {
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  },
  bankAccounts: {
    where: { active: true },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.EmployeeInclude;
type Personal = Prisma.EmployeeGetPayload<{ include: typeof personalInclude }>;

const clean = (v?: string | null) => v?.trim() || null;

// The API keeps the original single-address and single-contact shape; the
// data lives in employee_addresses and employee_emergency_contacts.
export function addressView(e: Pick<Personal, "addresses">) {
  const current = e.addresses.find((a) => a.type === "CURRENT");
  const permanent = e.addresses.find((a) => a.type === "PERMANENT");
  if (!current && !permanent) return null;
  return {
    current: current?.line ?? "",
    permanent: permanent?.line ?? "",
    city: current?.city ?? "",
    state: current?.state ?? "",
    pin: current?.pin ?? "",
    country: current?.country ?? "",
  };
}
export function emergencyView(e: Pick<Personal, "emergencyContacts">) {
  const c = e.emergencyContacts[0];
  return c
    ? { name: c.name, relationship: c.relationship ?? "", phone: c.phone ?? "" }
    : null;
}
export function contactList(e: Pick<Personal, "emergencyContacts">) {
  return e.emergencyContacts.map((c) => ({
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    phone: c.phone,
    isPrimary: c.isPrimary,
  }));
}
export function primaryBank(e: Pick<Personal, "bankAccounts">) {
  return e.bankAccounts.find((b) => b.isPrimary) ?? null;
}

export async function writeAddress(
  tx: Tx,
  companyId: string,
  employeeId: string,
  a: Address,
) {
  const rows = [
    {
      type: "CURRENT",
      line: clean(a.current),
      city: clean(a.city),
      state: clean(a.state),
      pin: clean(a.pin),
      country: clean(a.country),
    },
    { type: "PERMANENT", line: clean(a.permanent) },
  ];
  for (const { type, ...data } of rows) {
    const empty = Object.values(data).every((v) => v === null);
    if (empty)
      await tx.employeeAddress.deleteMany({
        where: { companyId, employeeId, type },
      });
    else
      await tx.employeeAddress.upsert({
        where: { employeeId_type: { employeeId, type } },
        create: { companyId, employeeId, type, ...data },
        update: data,
      });
  }
}
// The single-contact form edits the primary contact.
export async function writePrimaryContact(
  tx: Tx,
  companyId: string,
  employeeId: string,
  c: Emergency,
) {
  const data = {
    name: clean(c.name),
    relationship: clean(c.relationship),
    phone: clean(c.phone),
  };
  const primary = await tx.employeeEmergencyContact.findFirst({
    where: { companyId, employeeId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (!data.name && !data.phone) {
    if (primary)
      await tx.employeeEmergencyContact.delete({ where: { id: primary.id } });
    return;
  }
  const values = { ...data, name: data.name ?? "Emergency contact" };
  if (primary)
    await tx.employeeEmergencyContact.update({
      where: { id: primary.id },
      data: { ...values, isPrimary: true },
    });
  else
    await tx.employeeEmergencyContact.create({
      data: { companyId, employeeId, ...values, isPrimary: true },
    });
}
// A changed account becomes the new primary; the previous one is kept,
// deactivated, as history. Clearing the account deactivates it.
export async function writePrimaryBank(
  tx: Tx,
  ctx: Pick<Context, "companyId" | "userId">,
  employeeId: string,
  input: {
    accountNumber?: string | null;
    ifsc?: string | null;
    bankName?: string | null;
    holderName?: string | null;
  },
) {
  const accountNumber = input.accountNumber?.replace(/\s+/g, "") || null;
  const ifsc = clean(input.ifsc)?.toUpperCase() ?? null;
  const current = await tx.employeeBankAccount.findFirst({
    where: {
      companyId: ctx.companyId,
      employeeId,
      active: true,
      isPrimary: true,
    },
  });
  if (
    current &&
    accountNumber &&
    decrypt(current.accountEncrypted).accountNumber === accountNumber &&
    current.ifsc === ifsc
  )
    return current;
  if (current)
    await tx.employeeBankAccount.update({
      where: { id: current.id },
      data: { active: false, isPrimary: false, deactivatedAt: new Date() },
    });
  if (!accountNumber && !ifsc) return null;
  // The employee form may record the number before the IFSC is known.
  if (!accountNumber)
    throw new AppError(422, "Give the bank account number with the IFSC.");
  return tx.employeeBankAccount.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      accountEncrypted: encrypt({ accountNumber }),
      accountLast4: accountNumber.slice(-4),
      ifsc,
      bankName: clean(input.bankName),
      holderName: clean(input.holderName),
      createdBy: ctx.userId,
    },
  });
}
export const maskAccount = (last4: string) => `XXXX${last4}`;

const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().max(60).nullable().default(null),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/)
      .nullable()
      .default(null),
    isPrimary: z.boolean().default(false),
  })
  .strict();
const bankSchema = z
  .object({
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{6,20}$/, "Account numbers have 6 to 20 digits."),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC."),
    bankName: z.string().trim().max(120).nullable().default(null),
    holderName: z.string().trim().max(120).nullable().default(null),
  })
  .strict();

async function target(ctx: Context, employeeId: string | "me") {
  if (employeeId === "me") {
    const me = await linkedEmployee(ctx);
    if (!me)
      throw new AppError(403, "Your account needs a linked employee record.");
    return { id: me.id, own: true };
  }
  const e = await db.employee.findFirst({
    where: { id: employeeId, companyId: ctx.companyId },
    select: { id: true },
  });
  if (!e) throw new AppError(404, "Employee not found.", "NOT_FOUND");
  return { id: e.id, own: false };
}

// Multiple emergency contacts: HR (employees.read/write) for anyone, and
// employees (profile.read/write) for themselves via employeeId "me".
export async function emergencyContactsRoute(
  req: NextRequest,
  ctx: Context,
  employeeId: string | "me",
  contactId?: string,
) {
  const read = req.method === "GET";
  const t = await target(ctx, employeeId);
  requirePermission(
    ctx,
    t.own
      ? read
        ? "profile.read"
        : "profile.write"
      : read
        ? "employees.read"
        : "employees.write",
  );
  const list = () =>
    db.employeeEmergencyContact.findMany({
      where: { companyId: ctx.companyId, employeeId: t.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        relationship: true,
        phone: true,
        isPrimary: true,
      },
    });
  if (read && !contactId) return list();
  const existing = contactId
    ? await db.employeeEmergencyContact.findFirst({
        where: { id: contactId, companyId: ctx.companyId, employeeId: t.id },
      })
    : null;
  if (contactId && !existing)
    throw new AppError(404, "Contact not found.", "NOT_FOUND");
  await db.$transaction(async (tx) => {
    if (req.method === "DELETE" && existing) {
      await tx.employeeEmergencyContact.delete({ where: { id: existing.id } });
      // Another contact takes over as primary.
      if (existing.isPrimary) {
        const next = await tx.employeeEmergencyContact.findFirst({
          where: { companyId: ctx.companyId, employeeId: t.id },
          orderBy: { createdAt: "asc" },
        });
        if (next)
          await tx.employeeEmergencyContact.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
      }
    } else if (
      (req.method === "POST" && !contactId) ||
      (req.method === "PUT" && existing)
    ) {
      const b = contactSchema.parse(await json(req));
      const count = await tx.employeeEmergencyContact.count({
        where: { companyId: ctx.companyId, employeeId: t.id },
      });
      if (!existing && count >= 5)
        throw new AppError(409, "Up to five emergency contacts can be added.");
      const primary = b.isPrimary || (!existing && count === 0);
      if (primary)
        await tx.employeeEmergencyContact.updateMany({
          where: { companyId: ctx.companyId, employeeId: t.id },
          data: { isPrimary: false },
        });
      if (existing)
        await tx.employeeEmergencyContact.update({
          where: { id: existing.id },
          data: { ...b, isPrimary: primary || existing.isPrimary },
        });
      else
        await tx.employeeEmergencyContact.create({
          data: {
            ...b,
            isPrimary: primary,
            companyId: ctx.companyId,
            employeeId: t.id,
          },
        });
    } else throw new AppError(405, "Method not allowed.");
    await audit(
      tx,
      ctx,
      `EMERGENCY_CONTACT_${req.method === "DELETE" ? "DELETE" : existing ? "UPDATE" : "CREATE"}`,
      "employees",
      t.id,
      undefined,
      undefined,
      ip(req),
    );
  });
  return list();
}

// Salary bank accounts with history. Reading account numbers and changing
// them both require employees.sensitive; employees cannot change their own.
export async function bankAccountsRoute(
  req: NextRequest,
  ctx: Context,
  employeeId: string,
) {
  requirePermission(ctx, "employees.sensitive");
  if (req.method !== "GET") requirePermission(ctx, "employees.write");
  const t = await target(ctx, employeeId);
  if (req.method === "POST") {
    const b = bankSchema.parse(await json(req));
    await db.$transaction(async (tx) => {
      await writePrimaryBank(tx, ctx, t.id, b);
      await audit(
        tx,
        ctx,
        "BANK_ACCOUNT_CHANGE",
        "employees",
        t.id,
        undefined,
        { accountLast4: b.accountNumber.slice(-4), ifsc: b.ifsc },
        ip(req),
      );
    });
  } else if (req.method !== "GET")
    throw new AppError(405, "Method not allowed.");
  const rows = await db.employeeBankAccount.findMany({
    where: { companyId: ctx.companyId, employeeId: t.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    accountNumber: decrypt(r.accountEncrypted).accountNumber,
    accountMasked: maskAccount(r.accountLast4),
    ifsc: r.ifsc,
    bankName: r.bankName,
    holderName: r.holderName,
    isPrimary: r.isPrimary,
    active: r.active,
    createdAt: r.createdAt,
    deactivatedAt: r.deactivatedAt,
  }));
}
