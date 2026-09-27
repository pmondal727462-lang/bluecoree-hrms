"use client";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { api } from "@/lib/api-client";
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
function download(slip: Payslip, brand?: Me["branding"]) {
  const rows = [
    ...(brand?.brandName ? [["Company", brand.brandName]] : []),
    [
      "Employee",
      `${slip.employee?.employeeCode || "Self"} ${slip.employee ? `- ${slip.employee.firstName} ${slip.employee.lastName}` : ""}`,
    ],
    [
      "Period",
      `${slip.periodStart.slice(0, 10)} to ${slip.periodEnd.slice(0, 10)}`,
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
    ["Issued", new Date(slip.issuedAt).toLocaleDateString("en-IN")],
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
  a.download = `payslip-${slip.periodStart.slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
export function Payslips({ me }: { me: Me }) {
  const result = useQuery({
    queryKey: ["payslips"],
    queryFn: () => api<Payslip[]>("payroll/payslips"),
  });
  if (result.error)
    return <div className="card p-6 error">{result.error.message}</div>;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow mb-3">Payroll</div>
          <h1>My payslips</h1>
          <p>View and download payslips issued for your employee account.</p>
        </div>
      </div>
      <section className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Gross pay</th>
                <th>Deductions</th>
                <th>Net pay</th>
                <th>Issued</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(result.data || []).map((slip) => (
                <tr key={slip.id}>
                  <td>
                    <span className="font-semibold">
                      {slip.periodStart.slice(0, 10)} –{" "}
                      {slip.periodEnd.slice(0, 10)}
                    </span>
                  </td>
                  <td>{money(slip.grossPay, slip.currency)}</td>
                  <td>{money(slip.deductions, slip.currency)}</td>
                  <td className="font-semibold">
                    {money(slip.netPay, slip.currency)}
                  </td>
                  <td>{new Date(slip.issuedAt).toLocaleDateString("en-IN")}</td>
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
                      onClick={() => download(slip, me.branding)}
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
        {!result.isLoading && !result.data?.length && (
          <div className="empty">
            <FileText className="mx-auto mb-2" />
            No payslips have been issued yet.
          </div>
        )}
      </section>
    </>
  );
}
