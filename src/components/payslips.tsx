"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatCompanyDate, formatCompanyDateTime } from "@/lib/company-date";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";

type Payslip = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossPay: number;
  deductions: number;
  netPay: number;
  currency: string;
  issuedAt: string;
  breakdown?: {
    demo?: boolean;
    earnings: Record<string, number>;
    deductions: Record<string, number>;
    reimbursements: number;
    days: { total: number; lop: number; paid: number };
  } | null;
  employee?: { employeeCode: string; firstName: string; lastName: string };
};
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(value);
const earningLabels: Record<string, string> = {
  basic: "Basic",
  hra: "HRA",
  specialAllowance: "Special allowance",
  otherAllowance: "Other allowance",
};
const deductionLabels: Record<string, string> = {
  pf: "Provident fund",
  esi: "ESI",
  professionalTax: "Professional tax",
  tds: "Income tax (TDS)",
  other: "Other deductions",
};
function download(slip: Payslip, me: Me) {
  const brand = me.branding;
  const rows = [
    ...(brand?.brandName ? [["Company", brand.brandName]] : []),
    [
      "Employee",
      `${slip.employee?.employeeCode || "Self"} ${slip.employee ? `- ${slip.employee.firstName} ${slip.employee.lastName}` : ""}`,
    ],
    [
      "Period",
      `${formatCompanyDate(slip.periodStart, me.company.dateFormat)} to ${formatCompanyDate(slip.periodEnd, me.company.dateFormat)}`,
    ],
    ...(slip.breakdown
      ? [
          [
            "Paid days",
            `${slip.breakdown.days.paid} of ${slip.breakdown.days.total} (LOP ${slip.breakdown.days.lop})`,
          ],
          ...Object.entries(slip.breakdown.earnings).map(([k, v]) => [
            earningLabels[k] ?? k,
            money(v, slip.currency),
          ]),
        ]
      : []),
    ["Gross pay", money(slip.grossPay, slip.currency)],
    ...(slip.breakdown
      ? Object.entries(slip.breakdown.deductions)
          .filter(([, v]) => v)
          .map(([k, v]) => [deductionLabels[k] ?? k, money(v, slip.currency)])
      : []),
    ["Deductions", money(slip.deductions, slip.currency)],
    ...(slip.breakdown?.reimbursements
      ? [
          [
            "Reimbursements",
            money(slip.breakdown.reimbursements, slip.currency),
          ],
        ]
      : []),
    ["Net pay", money(slip.netPay, slip.currency)],
    [
      "Issued",
      formatCompanyDateTime(
        slip.issuedAt,
        me.company.timezone ?? "Asia/Kolkata",
        me.company.dateFormat,
      ),
    ],
    ...(slip.breakdown?.demo
      ? [
          [
            "Note",
            "Fictional demo payslip. Sample amounts only; no payment initiated.",
          ],
        ]
      : []),
    ...(brand?.payslipFooter ? [["Note", brand.payslipFooter]] : []),
  ];
  const csv = rows
    .map(([key, value]) => `"${key}","${value.replaceAll('"', '""')}"`)
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `payslip-${slip.employee?.employeeCode ?? "self"}-${slip.periodEnd.slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
export function Payslips({ me }: { me: Me }) {
  const companyView = me.permissions.includes("payroll.read");
  const [period, setPeriod] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page) });
  if (period) query.set("period", period);
  if (companyView && search) query.set("search", search);
  const result = useQuery({
    queryKey: ["payslips", me.companyId, query.toString()],
    queryFn: () =>
      api<{ items: Payslip[]; total: number; page: number; pageSize: number }>(
        `payroll/payslips?${query}`,
      ),
  });
  if (result.error)
    return <div className="card p-6 error">{result.error.message}</div>;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Payroll</div>
          <h1>{companyView ? "Employee payslips" : "My payslips"}</h1>
          <p>
            {companyView
              ? "View and download payslips issued to your company's employees."
              : "View and download payslips issued for your employee account."}
          </p>
        </div>
      </div>
      <section className="card">
        <div className="toolbar flex flex-wrap gap-4 items-end">
          <label>
            Salary month
            <input
              type="month"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {companyView && (
            <label>
              Employee name or code
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search employees"
              />
            </label>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setPeriod("");
              setSearch("");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
          {me.permissions.includes("payroll.manage") && (
            <Link
              className="text-blue-700 underline font-semibold"
              href={`/payroll?period=${period || new Date().toISOString().slice(0, 7)}`}
            >
              Generate payslips
            </Link>
          )}
        </div>
        {companyView && (
          <p className="text-sm muted px-5 pb-3">
            Salary month is the month the salary period ends. Generate payslips
            opens payroll for calculation, approval and processing.
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {companyView && <th>Employee</th>}
                <th>Period</th>
                <th>Gross pay</th>
                <th>Deductions</th>
                <th>Net pay</th>
                <th>Issued</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(result.data?.items || []).map((slip) => (
                <tr key={slip.id}>
                  {companyView && (
                    <td>
                      <span className="font-semibold">
                        {slip.employee?.firstName} {slip.employee?.lastName}
                      </span>
                      <div className="muted text-xs">
                        {slip.employee?.employeeCode}
                      </div>
                    </td>
                  )}
                  <td>
                    <span className="font-semibold">
                      {formatCompanyDate(
                        slip.periodStart,
                        me.company.dateFormat,
                      )}{" "}
                      –{" "}
                      {formatCompanyDate(slip.periodEnd, me.company.dateFormat)}
                    </span>
                    {slip.breakdown?.demo && (
                      <div className="muted text-xs">
                        Demo sample · no payment initiated
                      </div>
                    )}
                  </td>
                  <td>{money(slip.grossPay, slip.currency)}</td>
                  <td>{money(slip.deductions, slip.currency)}</td>
                  <td className="font-semibold">
                    {money(slip.netPay, slip.currency)}
                  </td>
                  <td>
                    {formatCompanyDateTime(
                      slip.issuedAt,
                      me.company.timezone ?? "Asia/Kolkata",
                      me.company.dateFormat,
                    )}
                  </td>
                  <td className="flex gap-2">
                    <a
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold"
                      href={`/api/payroll/payslips/${slip.id}/pdf`}
                    >
                      <Download size={14} /> PDF
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => download(slip, me)}
                    >
                      <Download /> CSV
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.isLoading && <div className="empty">Loading payslips…</div>}
        {!result.isLoading && !result.data?.items.length && (
          <div className="empty">
            <FileText className="mx-auto mb-2" />
            {period || search
              ? "No payslips match these filters."
              : "No payslips have been issued yet."}
            {me.permissions.includes("payroll.manage") ? (
              <p className="mt-2">
                Add salary structures and process an approved run in{" "}
                <a className="text-blue-700 underline" href="/payroll">
                  Payroll
                </a>{" "}
                to generate employee payslips.
              </p>
            ) : (
              <p className="mt-2">
                Your payslips will appear after HR processes payroll.
              </p>
            )}
          </div>
        )}
      </section>
      {result.data && (
        <div className="flex justify-between items-center mt-4 text-sm">
          <span>
            {result.data.total} payslip(s) · Page {page} of{" "}
            {Math.max(1, Math.ceil(result.data.total / 25))}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page * 25 >= result.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
