import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { exportTable } from "../../src/lib/export";

const table = {
  title: "Employees: Q3",
  columns: [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
  ],
  rows: [
    { code: "E1", name: '=HYPERLINK("x")' },
    { code: "E2", name: "Anand Kumar" },
    { code: "E3", name: "आनंद" },
  ],
};

describe("table export", () => {
  it("escapes spreadsheet formulas and quotes in CSV", async () => {
    const res = await exportTable(table, "csv");
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("utf8");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="Employees-Q3.csv"',
    );
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain('"आनंद"');
    expect(res.headers.get("x-export-rows")).toBe("3");
  });

  it("keeps Excel cells as plain text", async () => {
    const res = await exportTable(table, "xlsx");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await res.arrayBuffer());
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, "Code", "Name"]);
    expect(sheet.getCell("B2").value).toBe('=HYPERLINK("x")');
    expect(sheet.getCell("B2").formula).toBeUndefined();
  });

  it("renders a paginated PDF, replacing characters the font lacks", async () => {
    const many = {
      ...table,
      rows: Array.from({ length: 120 }, (_, i) => ({
        code: `E${i}`,
        name: i % 2 ? "आनंद" : "A very long employee name ".repeat(8),
      })),
    };
    const res = await exportTable(many, "pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("returns JSON with the truncation flag", async () => {
    const res = await exportTable({ ...table, truncated: true }, "json");
    const body = await res.json();
    expect(body).toMatchObject({ title: "Employees: Q3", truncated: true });
    expect(body.rows).toHaveLength(3);
  });
});
