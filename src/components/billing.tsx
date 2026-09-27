"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { RecordForm } from "./record-form";
import { Table, when, type Notify } from "./platform";

type Plan = {
  code: string;
  name: string;
  priceMonthly: number | null;
  priceAnnual: number | null;
  pricePerEmployeeMonthly: number | null;
  pricePerEmployeeAnnual: number | null;
  currency: string;
};
type AddOn = {
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceAnnual: number;
  perEmployee: boolean;
};
type Quote = {
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  taxRate: number;
};
type Invoice = {
  id: string;
  number: string;
  issuedAt: string;
  total: number;
  status: string;
  planCode: string;
  billingCycle: string;
  refundedAmount: number;
};
type Billing = {
  gstin: string | null;
  billingState: string | null;
  billingEmail: string | null;
  address: string | null;
};
type Checkout = {
  invoice: Invoice;
  payment: {
    provider: string;
    status: string;
    instructions?: string;
    orderId?: string;
    keyId?: string;
    amountPaise?: number;
    currency?: string;
  };
};
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    v,
  );
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}
function loadRazorpay() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// Choose a plan, billing cycle and add-ons, see the GST quote, and pay.
export function BillingPanel({
  plans,
  addOns,
  billing,
  currentPlan,
  canBuy,
  notify,
}: {
  plans: Plan[];
  addOns: AddOn[];
  billing: Billing;
  currentPlan: string;
  canBuy: boolean;
  notify: Notify;
}) {
  const client = useQueryClient();
  const paid = plans.filter(
    (p) =>
      p.code !== "FREE_TRIAL" &&
      (p.priceMonthly !== null || p.pricePerEmployeeMonthly !== null),
  );
  const [planCode, setPlan] = useState(
    paid.find((p) => p.code === currentPlan)?.code ?? paid[0]?.code ?? "",
  );
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [chosen, setChosen] = useState<string[]>([]);
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const invoices = useQuery({
    queryKey: ["subscription", "invoices"],
    queryFn: () => api<Invoice[]>("subscription/invoices"),
  });
  const purchase = () => ({
    planCode,
    cycle,
    addOns: chosen.map((code) => ({ code, quantity: 1 })),
    ...(coupon ? { couponCode: coupon.trim().toUpperCase() } : {}),
  });
  useEffect(() => {
    if (!planCode || !canBuy) return;
    let live = true;
    setError("");
    api<Quote>("subscription/quote", {
      method: "POST",
      body: JSON.stringify(purchase()),
    })
      .then((q) => live && setQuote(q))
      .catch((e: Error) => live && (setQuote(null), setError(e.message)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planCode, cycle, chosen.join(","), coupon, canBuy]);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["subscription"] });
  const checkout = async () => {
    setError("");
    const r = await api<Checkout>("subscription/checkout", {
      method: "POST",
      body: JSON.stringify(purchase()),
    });
    if (
      r.payment.provider === "RAZORPAY" &&
      (await loadRazorpay()) &&
      window.Razorpay
    ) {
      new window.Razorpay({
        key: r.payment.keyId,
        order_id: r.payment.orderId,
        amount: r.payment.amountPaise,
        currency: r.payment.currency,
        name: "Subscription",
        description: r.invoice.number,
        handler: async (res: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          await api("subscription/verify", {
            method: "POST",
            body: JSON.stringify({
              orderId: res.razorpay_order_id,
              paymentId: res.razorpay_payment_id,
              signature: res.razorpay_signature,
            }),
          });
          notify("Payment received. Your subscription is active.");
          await refresh();
        },
      }).open();
    } else if (r.payment.provider === "NONE") {
      notify("Subscription activated.");
    } else setPending(r.payment.instructions ?? "Invoice issued.");
    await refresh();
  };
  return (
    <>
      {canBuy && (
        <section className="card p-6 mb-6 space-y-4">
          <h2 className="font-semibold">Billing details</h2>
          <p className="muted text-xs">
            Used on GST tax invoices. The place of supply decides CGST + SGST or
            IGST.
          </p>
          <RecordForm
            initial={billing}
            submitLabel="Save billing details"
            fields={[
              { key: "billingState", label: "State", required: true },
              { key: "gstin", label: "GSTIN (if registered)" },
              { key: "billingEmail", label: "Billing email", type: "email" },
              { key: "address", label: "Billing address", type: "textarea" },
            ]}
            onSave={async (v) => {
              await api("subscription/billing-profile", {
                method: "PUT",
                body: JSON.stringify({
                  billingState: v.billingState,
                  gstin: v.gstin ? v.gstin.toUpperCase() : null,
                  billingEmail: v.billingEmail || null,
                  address: v.address || null,
                }),
              });
              notify("Billing details saved.");
              await refresh();
            }}
          />
        </section>
      )}
      {canBuy && paid.length > 0 && (
        <section className="card p-6 mb-6 space-y-4">
          <h2 className="font-semibold">Buy or change plan</h2>
          <div className="flex flex-wrap gap-4">
            <label>
              Plan
              <select
                value={planCode}
                onChange={(e) => setPlan(e.target.value)}
              >
                {paid.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Billing
              <select
                value={cycle}
                onChange={(e) =>
                  setCycle(e.target.value as "MONTHLY" | "ANNUAL")
                }
              >
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </label>
            <label>
              Coupon
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <fieldset className="grid sm:grid-cols-2 gap-2">
            {addOns.map((a) => (
              <label key={a.code} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="w-auto mt-1"
                  checked={chosen.includes(a.code)}
                  onChange={(e) =>
                    setChosen(
                      e.target.checked
                        ? [...chosen, a.code]
                        : chosen.filter((c) => c !== a.code),
                    )
                  }
                />
                <span>
                  {a.name} ·{" "}
                  {inr(cycle === "ANNUAL" ? a.priceAnnual : a.priceMonthly)}
                  {a.perEmployee ? " per employee" : ""}/
                  {cycle === "ANNUAL" ? "year" : "month"}
                  {a.description && (
                    <span className="muted block text-xs">{a.description}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          {error && <div className="error">{error}</div>}
          {quote && (
            <Table
              headers={["Item", "Qty", "Rate", "Amount"]}
              empty=""
              rows={[
                ...quote.lines.map((l) => [
                  l.description,
                  l.quantity,
                  inr(l.unitPrice),
                  inr(l.amount),
                ]),
                ...(quote.discount
                  ? [["Discount", "", "", `−${inr(quote.discount)}`]]
                  : []),
                ...(quote.igst
                  ? [[`IGST ${quote.taxRate}%`, "", "", inr(quote.igst)]]
                  : [
                      [`CGST ${quote.taxRate / 2}%`, "", "", inr(quote.cgst)],
                      [`SGST ${quote.taxRate / 2}%`, "", "", inr(quote.sgst)],
                    ]),
                [
                  <strong key="t">Total</strong>,
                  "",
                  "",
                  <strong key="v">{inr(quote.total)}</strong>,
                ],
              ]}
            />
          )}
          {pending && <div className="card p-3 text-sm">{pending}</div>}
          <Button
            disabled={!quote || !billing.billingState}
            onClick={() => checkout().catch((e: Error) => setError(e.message))}
          >
            {billing.billingState
              ? "Pay and activate"
              : "Add billing details first"}
          </Button>
          <p className="muted text-xs">
            Card and UPI details are entered with the payment provider and never
            stored by us.
          </p>
        </section>
      )}
      <section className="card mb-6">
        <div className="card-title">
          <h2>Invoices and payments</h2>
        </div>
        <Table
          headers={["Invoice", "Date", "Plan", "Total", "Status", ""]}
          loading={invoices.isLoading}
          error={invoices.error}
          empty="No invoices yet."
          rows={(invoices.data ?? []).map((i) => [
            i.number,
            when(i.issuedAt),
            `${i.planCode} · ${i.billingCycle.toLowerCase()}`,
            inr(i.total),
            <span
              key="s"
              className={`badge ${i.status === "PAID" ? "positive" : "amber"}`}
            >
              {i.status.toLowerCase().replace("_", " ")}
              {i.refundedAmount ? ` · ${inr(i.refundedAmount)} refunded` : ""}
            </span>,
            <a
              key="d"
              className="inline-flex items-center gap-1 text-xs font-semibold"
              href={`/api/subscription/invoices/${i.id}/pdf`}
            >
              <Download size={14} /> PDF
            </a>,
          ])}
        />
      </section>
    </>
  );
}
