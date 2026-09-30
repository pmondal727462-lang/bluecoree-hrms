import { NextResponse } from "next/server";
import { canUse } from "@/modules/saas/service";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { db } from "@/lib/db";
import { pdfText } from "@/lib/export";
import { AppError } from "@/lib/errors";
import type { Context } from "@/modules/auth/service";

type Breakdown = {
  earnings?: Record<string, number>;
  deductions?: Record<string, number>;
  employer?: Record<string, number>;
  reimbursements?: number;
  days?: { total?: number; lop?: number; paid?: number; absent?: number };
  overtime?: { minutes?: number; pay?: number };
  encashment?: { days?: number; pay?: number };
} | null;

const labels: Record<string, string> = {
  basic: "Basic",
  hra: "House rent allowance",
  conveyance: "Conveyance",
  specialAllowance: "Special allowance",
  otherAllowance: "Other allowance",
  bonus: "Bonus",
  incentive: "Incentive",
  overtime: "Overtime",
  leaveEncashment: "Leave encashment",
  otherEarnings: "Other earnings",
  pf: "Provident fund",
  esi: "Employee state insurance",
  professionalTax: "Professional tax",
  tds: "Income tax (TDS)",
  loan: "Loan recovery",
  advance: "Advance recovery",
  other: "Other deductions",
  pfEpf: "PF (EPF)",
  pfEps: "PF (EPS)",
  edli: "EDLI",
  pfAdmin: "PF admin charges",
};
const label = (k: string) =>
  labels[k] ??
  k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
// The built-in font covers Windows-1252 only, so the rupee sign is written out.
const text = (v: unknown) => pdfText(v === undefined ? "" : String(v));
const amount = (n: number) =>
  n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const monthName = (d: Date) =>
  d.toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// Server-generated payslip (spec §25). Employees may download only their own.
export async function payslipPdf(ctx: Context, id: string) {
  const slip = await db.payslip.findFirst({
    where: { id, companyId: ctx.companyId },
    include: {
      employee: {
        select: {
          userId: true,
          employeeCode: true,
          firstName: true,
          middleName: true,
          lastName: true,
          joinedAt: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
        },
      },
    },
  });
  const canRead = ctx.permissions.includes("payroll.read");
  if (
    !slip ||
    (!canRead &&
      !(
        ctx.permissions.includes("payroll.self") &&
        slip.employee.userId === ctx.userId
      ))
  )
    throw new AppError(404, "Payslip not found.", "NOT_FOUND");
  const company: {
    name: string;
    address: string | null;
    branding: {
      brandName: string | null;
      payslipFooter: string | null;
      logoData: Uint8Array | null;
      logoType: string | null;
      primaryColor: string | null;
    } | null;
  } = await db.company.findUniqueOrThrow({
    where: { id: ctx.companyId },
    select: {
      name: true,
      address: true,
      branding: {
        select: {
          brandName: true,
          payslipFooter: true,
          logoData: true,
          logoType: true,
          primaryColor: true,
        },
      },
    },
  });
  // Brand name, colour, logo and footer apply with the white-label module.
  if (!(await canUse(ctx.companyId, "whitelabel"))) company.branding = null;
  const b = (slip.breakdown ?? {}) as NonNullable<Breakdown>;

  const doc = await PDFDocument.create();
  doc.setTitle(`Payslip ${monthName(slip.periodEnd)}`);
  const page = doc.addPage([595, 842]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const m = 40;
  const W = 595 - m * 2;
  let y = 842 - m;
  const hex = company.branding?.primaryColor?.match(/^#([0-9a-f]{6})$/i)?.[1];
  const accent = hex
    ? rgb(
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      )
    : rgb(0.15, 0.3, 0.6);
  const grey = rgb(0.4, 0.4, 0.4);
  const draw = (
    s: unknown,
    x: number,
    size = 9,
    f: PDFFont = font,
    color = rgb(0.1, 0.1, 0.1),
  ) => page.drawText(text(s), { x, y, size, font: f, color });
  const right = (s: string, x: number, size = 9, f: PDFFont = font) =>
    page.drawText(text(s), {
      x: x - f.widthOfTextAtSize(text(s), size),
      y,
      size,
      font: f,
    });

  // Header: logo (PNG or JPEG), company name and address.
  let textX = m;
  const logo = company.branding?.logoData;
  if (logo) {
    try {
      const img = /png/i.test(company.branding?.logoType ?? "")
        ? await doc.embedPng(logo)
        : /jpe?g/i.test(company.branding?.logoType ?? "")
          ? await doc.embedJpg(logo)
          : null;
      if (img) {
        const s = img.scaleToFit(80, 40);
        page.drawImage(img, { x: m, y: y - s.height + 10, ...s });
        textX = m + s.width + 12;
      }
    } catch {
      // An unreadable logo does not stop the payslip.
    }
  }
  draw(company.branding?.brandName || company.name, textX, 15, bold, accent);
  y -= 14;
  if (company.address)
    draw(company.address.slice(0, 110), textX, 8, font, grey);
  y -= 26;
  draw(`Payslip for ${monthName(slip.periodEnd)}`, m, 12, bold);
  y -= 8;
  page.drawLine({
    start: { x: m, y },
    end: { x: m + W, y },
    thickness: 1,
    color: accent,
  });
  y -= 18;

  // Employee and attendance summary.
  const e = slip.employee;
  const days = b.days ?? {};
  const facts: [string, string][] = [
    [
      "Employee",
      [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" "),
    ],
    ["Employee code", e.employeeCode],
    ["Department", e.department?.name ?? "-"],
    ["Designation", e.designation?.name ?? "-"],
    ["Date of joining", e.joinedAt.toISOString().slice(0, 10)],
    [
      "Pay period",
      `${slip.periodStart.toISOString().slice(0, 10)} to ${slip.periodEnd.toISOString().slice(0, 10)}`,
    ],
    ["Days in month", String(days.total ?? "-")],
    ["Paid days", String(days.paid ?? "-")],
    ["Loss of pay days", String(days.lop ?? 0)],
    ["Absent days", String(days.absent ?? 0)],
    [
      "Approved overtime",
      b.overtime?.minutes
        ? `${Math.round((b.overtime.minutes / 60) * 10) / 10} h`
        : "-",
    ],
    ["Leave encashed", b.encashment?.days ? `${b.encashment.days} days` : "-"],
  ];
  for (let i = 0; i < facts.length; i += 2) {
    for (const [j, x] of [
      [i, m],
      [i + 1, m + W / 2],
    ] as const) {
      const f = facts[j];
      if (!f) continue;
      draw(f[0], x, 8, font, grey);
      draw(f[1], x + 90, 9, bold);
    }
    y -= 15;
  }
  y -= 10;

  // Earnings and deductions side by side.
  const rows = (o?: Record<string, number>) =>
    Object.entries(o ?? {}).filter(([, v]) => Number(v) > 0);
  const earnings = rows(b.earnings);
  const deductions = rows(b.deductions);
  const colW = W / 2 - 10;
  page.drawRectangle({
    x: m,
    y: y - 5,
    width: W,
    height: 18,
    color: rgb(0.94, 0.95, 0.97),
  });
  draw("Earnings", m + 6, 9, bold);
  right("Amount (Rs.)", m + colW, 9, bold);
  draw("Deductions", m + colW + 26, 9, bold);
  right("Amount (Rs.)", m + W - 6, 9, bold);
  y -= 20;
  const n = Math.max(earnings.length, deductions.length);
  for (let i = 0; i < n; i++) {
    if (earnings[i]) {
      draw(label(earnings[i][0]), m + 6);
      right(amount(earnings[i][1]), m + colW);
    }
    if (deductions[i]) {
      draw(label(deductions[i][0]), m + colW + 26);
      right(amount(deductions[i][1]), m + W - 6);
    }
    y -= 14;
  }
  page.drawLine({
    start: { x: m, y: y + 8 },
    end: { x: m + W, y: y + 8 },
    thickness: 0.5,
    color: grey,
  });
  y -= 6;
  draw("Gross earnings", m + 6, 9, bold);
  right(amount(slip.grossPay), m + colW, 9, bold);
  draw("Total deductions", m + colW + 26, 9, bold);
  right(amount(slip.deductions), m + W - 6, 9, bold);
  y -= 18;
  if (b.reimbursements) {
    draw("Reimbursements (not taxed)", m + 6);
    right(amount(b.reimbursements), m + colW);
    y -= 16;
  }
  page.drawRectangle({ x: m, y: y - 7, width: W, height: 22, color: accent });
  page.drawText("Net pay", {
    x: m + 6,
    y,
    size: 11,
    font: bold,
    color: rgb(1, 1, 1),
  });
  const net = `Rs. ${amount(slip.netPay)}`;
  page.drawText(net, {
    x: m + W - 6 - bold.widthOfTextAtSize(net, 11),
    y,
    size: 11,
    font: bold,
    color: rgb(1, 1, 1),
  });
  y -= 34;

  const employer = rows(b.employer);
  if (employer.length) {
    draw("Employer contributions (not deducted from pay)", m, 9, bold);
    y -= 14;
    for (const [k, v] of employer) {
      draw(label(k), m + 6, 8.5);
      right(amount(v), m + colW, 8.5);
      y -= 12;
    }
    y -= 8;
  }
  const footer =
    company.branding?.payslipFooter ||
    "This is a computer-generated payslip and does not need a signature.";
  y = m + 10;
  draw(footer.slice(0, 140), m, 7.5, font, grey);

  const period = slip.periodEnd.toISOString().slice(0, 7);
  return new NextResponse(new Uint8Array(await doc.save()), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition":
        `attachment; filename="payslip-${e.employeeCode}-${period}.pdf"`.replace(
          /[^\x20-\x7e]/g,
          "",
        ),
      "cache-control": "no-store",
    },
  });
}
