import ExcelJS from "exceljs";

export type AttendanceReportDay = {
  date: string;
  status: string;
  inMinutes: number | null;
  outMinutes: number | null;
  workedMinutes: number | null;
};
export type AttendanceReportEmployee = {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  branch: string;
  department: string;
  bankName: string | null;
  ifsc: string | null;
  accountNumber: string | null;
  salary: number | null;
  days: AttendanceReportDay[];
};
const border: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD9D9D9" } },
  bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
  left: { style: "thin", color: { argb: "FFD9D9D9" } },
  right: { style: "thin", color: { argb: "FFD9D9D9" } },
};
const label = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// Mirrors the supplied workbook: branch sheets, department groups and four
// attendance rows for each employee, with bank/salary columns on the right.
export function attendanceWorkbook(
  company: string,
  from: string,
  to: string,
  timezone: string,
  dates: string[],
  employees: AttendanceReportEmployee[],
  canBank: boolean,
  canSalary: boolean,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = company;
  const branches = new Map<string, AttendanceReportEmployee[]>();
  for (const employee of employees) {
    const key = employee.branchId ?? "unassigned";
    branches.set(key, [...(branches.get(key) ?? []), employee]);
  }
  if (!employees.length) branches.set("empty", []);
  const names = new Set<string>();
  for (const group of branches.values()) {
    const branch = group[0]?.branch ?? "No records";
    const clean =
      branch
        .replace(/[\\/*?:\[\]]/g, " ")
        .replace(/^'+|'+$/g, "")
        .trim() || "Branch";
    let name = clean.slice(0, 31),
      suffix = 1;
    while (names.has(name.toLowerCase())) {
      const tail = ` (${++suffix})`;
      name = clean.slice(0, 31 - tail.length) + tail;
    }
    names.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "1:3",
      },
    });
    const dayEnd = dates.length + 1,
      lastCol = dayEnd + 4;
    sheet.getColumn(1).width = 34;
    for (let i = 2; i <= dayEnd; i++) sheet.getColumn(i).width = 10;
    [28, 17, 24, 20].forEach((width, i) => {
      sheet.getColumn(dayEnd + 1 + i).width = width;
    });
    sheet.mergeCells(1, 1, 1, lastCol);
    sheet.getCell(1, 1).value =
      `Attendance Report - ${branch} (${label(from)} to ${label(to)})`;
    sheet.getCell(1, 1).font = { name: "Calibri", size: 14, bold: true };
    sheet.getRow(1).height = 28;
    sheet.mergeCells(2, 1, 2, lastCol);
    sheet.getCell(2, 1).value =
      `${company} · Times: ${timezone} · Salary: issued net pay for the exact report period; blank if unavailable.${!canBank ? " Bank details restricted." : ""}${!canSalary ? " Salary details restricted." : ""}`;
    sheet.getCell(2, 1).font = { name: "Calibri", size: 10 };
    sheet.getRow(2).height = 23;
    sheet.getRow(3).values = [
      "Employee / attendance",
      ...dates.map((d) => new Date(`${d}T00:00:00Z`)),
      "BANK NAME",
      "IFSC CODE",
      "ACCOUNT NUMBER",
      "SALARY AMOUNT",
    ];
    sheet.getRow(3).height = 28;
    sheet.getRow(3).eachCell((cell, index) => {
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF7" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = border;
      if (index > 1 && index <= dayEnd)
        cell.numFmt =
          from.slice(0, 7) === to.slice(0, 7) ? "dd-ddd" : "dd-mmm-ddd";
    });
    let row = 4,
      department = "";
    for (const e of group) {
      if (e.department !== department) {
        department = e.department;
        sheet.mergeCells(row, 1, row, dayEnd);
        sheet.getCell(row, 1).value = `DEPARTMENT: ${department}`;
        sheet.getCell(row, 1).font = { name: "Calibri", size: 12, bold: true };
        sheet.getCell(row, 1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF0F0F0" },
        };
        sheet.getRow(row++).height = 23;
      }
      sheet.mergeCells(row, 1, row, dayEnd);
      sheet.getCell(row, 1).value = `${e.code} - ${e.name}`;
      sheet.getCell(row, 1).font = { name: "Calibri", size: 11, bold: true };
      [
        canBank ? e.bankName : null,
        canBank ? e.ifsc : null,
        canBank ? e.accountNumber : null,
        canSalary ? e.salary : null,
      ].forEach((v, i) => {
        const cell = sheet.getCell(row, dayEnd + i + 1);
        cell.value = v;
        cell.numFmt = i === 3 ? "#,##0.00" : "@";
      });
      sheet.getRow(row++).height = 23;
      for (const [index, kind] of ["Status", "In", "Out", "Total"].entries()) {
        sheet.getCell(row, 1).value = kind;
        e.days.forEach((day, i) => {
          const cell = sheet.getCell(row, i + 2);
          if (index === 0) cell.value = day.status;
          else {
            const value =
              index === 1
                ? day.inMinutes
                : index === 2
                  ? day.outMinutes
                  : day.workedMinutes;
            cell.value = value === null ? "-" : value / 1440;
            cell.numFmt = index === 3 ? "[h]:mm" : "hh:mm";
          }
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = border;
        });
        sheet.getRow(row++).height = 20;
      }
      row++;
    }
    sheet.mergeCells(row, 1, row, lastCol);
    sheet.getCell(row, 1).value =
      "P: Present · A: Absent · HD: Half day · HL: Half-day leave · L: Leave · WO: Weekly off · H: Holiday · MP: Missed punch · PR: Pending review · IN: Checked in · NA: Before joining · -: Not yet recorded";
    sheet.getCell(row, 1).alignment = { wrapText: true };
    sheet.getRow(row).height = 30;
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastCol).letter}${row}`;
  }
  return workbook;
}
