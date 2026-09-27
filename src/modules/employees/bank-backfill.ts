import { systemDb } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { writePrimaryBank } from "./contacts";

// Moves bank details saved before employee_bank_accounts existed out of the
// encrypted identity field into that table. Safe to run repeatedly: employees
// that already have an account row, or no bank details, are skipped. An IFSC
// without an account number is left in place and reported.
export async function backfillBankAccounts(companyIds?: string[]) {
  let moved = 0,
    skipped = 0;
  const incomplete: string[] = [];
  const employees = await systemDb.employee.findMany({
    where: {
      sensitiveEncrypted: { not: null },
      ...(companyIds ? { companyId: { in: companyIds } } : {}),
    },
    select: { id: true, companyId: true, sensitiveEncrypted: true },
  });
  for (const e of employees) {
    const { bankAccount, ifsc, ...identity } = decrypt(e.sensitiveEncrypted!);
    if (!bankAccount && !ifsc) {
      skipped++;
      continue;
    }
    const existing = await systemDb.employeeBankAccount.count({
      where: { companyId: e.companyId, employeeId: e.id },
    });
    if (!existing && !bankAccount) {
      incomplete.push(e.id);
      continue;
    }
    await systemDb.$transaction(async (tx) => {
      if (!existing)
        await writePrimaryBank(
          tx,
          { companyId: e.companyId, userId: "backfill" },
          e.id,
          { accountNumber: bankAccount, ifsc },
        );
      await tx.employee.update({
        where: { id: e.id },
        data: { sensitiveEncrypted: encrypt(identity) },
      });
    });
    moved++;
  }
  return { moved, skipped, incomplete };
}
