import type { Workbook, CellValue } from "exceljs";
import { employeeSchema } from "@/modules/shared/validators";

export const importColumns = [
  "employeeCode",
  "firstName",
  "lastName",
  "officialEmail",
  "joinedAt",
  "mobile",
  "personalEmail",
  "gender",
  "dateOfBirth",
  "employmentType",
  "status",
] as const;
export type ImportRow = {
  row: number;
  data: ReturnType<typeof employeeSchema.parse>;
};
function valueText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((v) => v.text).join("");
    if ("text" in value) return value.text;
    throw new Error("Use plain values instead of formulas or cell errors.");
  }
  return String(value).trim();
}
export function parseEmployeeWorkbook(workbook: Workbook) {
  const sheet = workbook.getWorksheet("Employees") || workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no worksheet.");
  if (sheet.rowCount > 1001)
    throw new Error(
      "Remove extra rows; the worksheet must contain at most 1,000 rows plus its header.",
    );
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = valueText(cell.value).trim();
  });
  const named = headers.filter(Boolean);
  if (new Set(named).size !== named.length)
    throw new Error("Column headers must be unique.");
  for (const name of importColumns.slice(0, 5)) {
    if (!headers.includes(name))
      throw new Error(
        `Missing required column: ${name}. Download the template.`,
      );
  }
  const unknown = named.filter(
    (name) => !(importColumns as readonly string[]).includes(name),
  );
  if (unknown.length)
    throw new Error(
      `Unsupported columns: ${unknown.join(", ")}. Use the template headers.`,
    );
  const rows: ImportRow[] = [],
    errors: string[] = [];
  const codes = new Set<string>(),
    emails = new Set<string>();
  let count = 0;
  sheet.eachRow((row, number) => {
    if (number === 1 || !row.hasValues) return;
    count++;
    try {
      const record: Record<string, string> = {};
      row.eachCell((cell, col) => {
        const value = valueText(cell.value).trim();
        if (!value) return;
        if (!headers[col - 1]) throw new Error(`Column ${col} needs a header.`);
        record[headers[col - 1]] = value;
      });
      if (!Object.keys(record).length) {
        count--;
        return;
      }
      const parsed = employeeSchema.safeParse(record);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      const data = parsed.data;
      if (codes.has(data.employeeCode) || emails.has(data.officialEmail))
        throw new Error(
          "Duplicate employee ID or official email in this workbook.",
        );
      codes.add(data.employeeCode);
      emails.add(data.officialEmail);
      rows.push({ row: number, data });
    } catch (error) {
      errors.push(
        `Row ${number}: ${error instanceof Error ? error.message : "Invalid values."}`,
      );
    }
  });
  if (count > 200) throw new Error("Import at most 200 employees at a time.");
  if (!count)
    throw new Error("Add employee details below the template headers first.");
  return { rows, errors };
}
