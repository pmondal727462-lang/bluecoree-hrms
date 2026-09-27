"use client";
import { useRef, useState } from "react";
import { Upload, Download } from "lucide-react";
import { api } from "@/lib/api-client";
import {
  importColumns,
  parseEmployeeWorkbook,
  type ImportRow,
} from "@/lib/employee-import";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function EmployeeImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]),
    [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  async function template() {
    setBusy(true);
    setErrors([]);
    try {
      const { Workbook } = await import("exceljs");
      const book = new Workbook();
      const sheet = book.addWorksheet("Employees");
      sheet.columns = importColumns.map((key) => ({
        header: key,
        key,
        width: 24,
        style: { numFmt: "@" },
      }));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      const buffer = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(buffer)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "employee-import-template.xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErrors(["Could not download the template. Please try again."]);
    } finally {
      setBusy(false);
    }
  }
  async function select(file?: File) {
    setRows([]);
    setErrors([]);
    setMessage("");
    if (!file) return;
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx"))
        throw new Error(
          "Choose an Excel .xlsx workbook. Save older .xls files as .xlsx first.",
        );
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a file smaller than 5 MB.");
      const { Workbook } = await import("exceljs");
      const book = new Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const result = parseEmployeeWorkbook(book);
      setRows(result.rows);
      setErrors(result.errors);
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : "Unable to read this workbook.",
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (lock.current || !rows.length || errors.length) return;
    lock.current = true;
    setBusy(true);
    let created = 0;
    const failures: string[] = [];
    for (const item of rows) {
      setMessage(`Importing ${created + 1} of ${rows.length}...`);
      try {
        await api("employees", {
          method: "POST",
          body: JSON.stringify(item.data),
        });
        created++;
      } catch (error) {
        failures.push(
          `Row ${item.row} (${item.data.employeeCode}): ${error instanceof Error ? error.message : "Request failed."} Import stopped. Check the directory before uploading remaining rows; this row may have been saved if the connection was interrupted.`,
        );
        break;
      }
    }
    setMessage(
      `${created} employee${created === 1 ? "" : "s"} added. ${rows.length - created} not confirmed as imported.`,
    );
    setErrors(failures);
    setRows([]);
    setBusy(false);
    lock.current = false;
    onImported();
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          setRows([]);
          setErrors([]);
          setMessage("");
        }}
      >
        <Upload />
        Import Excel
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="Import employees from Excel"
        description="Download the template, fill in your employees, then upload it for review. Up to 200 employees per import, 5 MB maximum."
      >
        <div className="space-y-4">
          <Button variant="outline" disabled={busy} onClick={template}>
            <Download />
            Download template
          </Button>
          <p className="text-sm muted">
            Required: employeeCode, firstName, lastName, officialEmail and
            joinedAt. Dates: YYYY-MM-DD. Employment type: Full time, Part time,
            Contract or Intern. Status: Active, Probation, On notice or
            Inactive. Blank type and status default to Full time and Active.
            Existing employees are never updated. Organization details can be
            added after import.
          </p>
          <label className="block text-sm font-medium">
            Excel workbook (.xlsx)
            <input
              className="block mt-2 w-full"
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(event) => {
                void select(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {errors.length > 0 && (
            <div role="alert" className="error max-h-48 overflow-auto">
              {errors.map((error, i) => (
                <p key={i}>{error}</p>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <>
              <p className="text-sm">
                {rows.length} valid employees.{" "}
                {errors.length
                  ? "Fix all errors and upload again before importing."
                  : "Review the employees below before importing."}
              </p>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Employee ID</th>
                      <th>Name</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ row, data }) => (
                      <tr key={row}>
                        <td>{row}</td>
                        <td>{data.employeeCode}</td>
                        <td>
                          {data.firstName} {data.lastName}
                        </td>
                        <td>{data.officialEmail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p role="status" className="text-sm">
            {message || (busy ? "Preparing workbook..." : "")}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button
              disabled={busy || !rows.length || !!errors.length}
              onClick={save}
            >
              {busy ? "Working..." : `Import ${rows.length || ""} employees`}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
