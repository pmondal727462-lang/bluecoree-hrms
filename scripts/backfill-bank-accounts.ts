import "dotenv/config";
import { systemDb } from "../src/lib/db";
import { backfillBankAccounts } from "../src/modules/employees/bank-backfill";

// One-time move of legacy bank details into employee_bank_accounts.
backfillBankAccounts()
  .then(({ moved, skipped, incomplete }) =>
    console.log(
      `Bank details moved for ${moved} employees; ${skipped} had none.` +
        (incomplete.length
          ? ` ${incomplete.length} have an IFSC but no account number and were left unchanged: ${incomplete.join(", ")}.`
          : ""),
    ),
  )
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => systemDb.$disconnect());
