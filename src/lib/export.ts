import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const exportFormats = ["csv", "xlsx", "pdf", "json"] as const;
export type ExportFormat = (typeof exportFormats)[number];
export type ExportColumn = { key: string; label: string };
type Cell = string | number | boolean | null | undefined;
export type ExportTable = {
  title: string;
  columns: ExportColumn[];
  rows: Record<string, Cell>[];
  // True when the dataset was larger than the rows included.
  truncated?: boolean;
};

const fileName = (title: string) =>
  title
    .replace(/[^A-Za-z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "export";
// Spreadsheet formula injection: text starting with = + - @ is prefixed.
const safeText = (v: Cell) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
// The built-in PDF font covers Windows-1252 only; other characters become "?".
export const pdfText = (v: Cell) =>
  (v === null || v === undefined ? "" : String(v)).replace(
    /[^\u0020-\u007e\u00a0-\u00ff]/g,
    "?",
  );

async function pdf(table: ExportTable) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = [842, 595]; // A4 landscape
  const margin = 32,
    size = 7.5,
    line = 12;
  const usable = width - margin * 2;
  const colWidth = usable / Math.max(table.columns.length, 1);
  const fit = (text: string, f = font) => {
    if (f.widthOfTextAtSize(text, size) <= colWidth - 4) return text;
    let t = text;
    while (t && f.widthOfTextAtSize(`${t}...`, size) > colWidth - 4)
      t = t.slice(0, -1);
    return `${t}...`;
  };
  let page = doc.addPage([width, height]);
  let y = height - margin;
  const header = () => {
    page.drawText(pdfText(table.title), {
      x: margin,
      y,
      size: 12,
      font: bold,
    });
    y -= 16;
    page.drawText(
      pdfText(
        `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC - ${table.rows.length} rows${table.truncated ? " (truncated)" : ""}`,
      ),
      { x: margin, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) },
    );
    y -= line + 4;
    table.columns.forEach((c, i) =>
      page.drawText(fit(pdfText(c.label), bold), {
        x: margin + i * colWidth,
        y,
        size,
        font: bold,
      }),
    );
    y -= 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= line;
  };
  header();
  for (const row of table.rows) {
    if (y < margin) {
      page = doc.addPage([width, height]);
      y = height - margin;
      header();
    }
    table.columns.forEach((c, i) =>
      page.drawText(fit(pdfText(row[c.key])), {
        x: margin + i * colWidth,
        y,
        size,
        font,
      }),
    );
    y -= line;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: width - margin - 60,
      y: margin / 2,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.4),
    }),
  );
  return doc.save();
}

// Renders a table as a download. Cells are plain values; callers choose the
// permitted columns and rows.
export async function exportTable(table: ExportTable, format: ExportFormat) {
  const name = fileName(table.title);
  const headers = {
    "cache-control": "no-store",
    "x-export-rows": String(table.rows.length),
    "x-export-truncated": String(!!table.truncated),
  };
  if (format === "json")
    return NextResponse.json(
      {
        title: table.title,
        columns: table.columns,
        rows: table.rows,
        truncated: !!table.truncated,
      },
      {
        headers: {
          ...headers,
          "content-disposition": `attachment; filename="${name}.json"`,
        },
      },
    );
  if (format === "csv") {
    const cell = (v: Cell) => `"${safeText(v).replaceAll('"', '""')}"`;
    const lines = [
      table.columns.map((c) => cell(c.label)).join(","),
      ...table.rows.map((r) =>
        table.columns.map((c) => cell(r[c.key])).join(","),
      ),
    ];
    return new NextResponse(`\uFEFF${lines.join("\r\n")}`, {
      headers: {
        ...headers,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.csv"`,
      },
    });
  }
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Export");
    sheet.addRow(table.columns.map((c) => c.label)).font = { bold: true };
    for (const r of table.rows)
      // String cells are stored as text, never evaluated as formulas.
      sheet.addRow(table.columns.map((c) => r[c.key] ?? null));
    return new NextResponse(new Uint8Array(await book.xlsx.writeBuffer()), {
      headers: {
        ...headers,
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}.xlsx"`,
      },
    });
  }
  return new NextResponse(new Uint8Array(await pdf(table)), {
    headers: {
      ...headers,
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${name}.pdf"`,
    },
  });
}
