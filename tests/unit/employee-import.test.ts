import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import {
  importColumns,
  parseEmployeeWorkbook,
} from "../../src/lib/employee-import";

function workbook() {
  const book = new Workbook();
  const sheet = book.addWorksheet("Employees");
  sheet.addRow([...importColumns]);
  return { book, sheet };
}
const employee = ["001", "Asha", "Patel", "asha@example.com", "2026-09-23"];
describe("employee Excel import", () => {
  it("reads an exported Excel workbook and preserves employee codes", async () => {
    const { book, sheet } = workbook();
    sheet.addRow(employee);
    const restored = new Workbook();
    await restored.xlsx.load(await book.xlsx.writeBuffer());
    const result = parseEmployeeWorkbook(restored);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data).toMatchObject({
      employeeCode: "001",
      status: "Active",
      employmentType: "Full time",
    });
  });
  it("accepts real Excel dates", () => {
    const { book, sheet } = workbook();
    sheet.addRow([...employee.slice(0, 4), new Date("2026-09-23T00:00:00Z")]);
    expect(parseEmployeeWorkbook(book).rows[0].data.joinedAt).toBe(
      "2026-09-23",
    );
  });
  it("reports invalid dates and duplicate emails with worksheet row numbers", () => {
    const { book, sheet } = workbook();
    sheet.addRow(employee);
    sheet.addRow(["002", "Other", "Person", "ASHA@example.com", "2026-09-23"]);
    sheet.addRow(["003", "Other", "Person", "other@example.com", "2026-02-30"]);
    const result = parseEmployeeWorkbook(book);
    expect(result.errors[0]).toContain("Row 3: Duplicate");
    expect(result.errors[1]).toContain("Row 4: joinedAt");
  });
  it("rejects formulas and unknown columns", () => {
    const { book, sheet } = workbook();
    sheet.addRow([{ formula: '"001"', result: "001" }, ...employee.slice(1)]);
    expect(parseEmployeeWorkbook(book).errors[0]).toContain("plain values");
    sheet.getCell("L1").value = "companyId";
    expect(() => parseEmployeeWorkbook(book)).toThrow("Unsupported columns");
  });
  it("rejects missing headers, empty workbooks and oversized batches", () => {
    expect(() => parseEmployeeWorkbook(new Workbook())).toThrow("no worksheet");
    const { book, sheet } = workbook();
    expect(() => parseEmployeeWorkbook(book)).toThrow("Add employee details");
    for (let i = 0; i < 201; i++)
      sheet.addRow([String(i), "A", "B", `${i}@example.com`, "2026-09-23"]);
    expect(() => parseEmployeeWorkbook(book)).toThrow("at most 200");
    sheet.getCell("A1").value = "";
    expect(() => parseEmployeeWorkbook(book)).toThrow(
      "Missing required column",
    );
  });
});
