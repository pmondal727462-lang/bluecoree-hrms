"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Table, when, type Notify } from "./platform";

type AddOn = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  feature: string | null;
  priceMonthly: number | null;
  priceAnnual: number;
  perEmployee: boolean;
  extraStorageMb: number | null;
  active: boolean;
  public: boolean;
};
type Coupon = {
  id: string;
  code: string;
  description: string | null;
  percentOff: number | null;
  amountOff: number | null;
  planCodes: string[];
  validUntil: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
};
type Invoice = {
  id: string;
  number: string;
  issuedAt: string;
  total: number;
  refundedAmount: number;
  status: string;
  planCode: string;
  company: { name: string; code: string };
};
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    v,
  );
const n = (v: string) => (v === "" ? null : Number(v));
const bool = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

// Super Admin: add-ons, coupons, invoices, offline payments and refunds.
export function PlatformBilling({
  me,
  notify,
  pricingOnly = false,
}: {
  me: Me;
  notify: Notify;
  pricingOnly?: boolean;
}) {
  const client = useQueryClient();
  const superAdmin = me.isSuperAdmin;
  const addOns = useQuery({
    queryKey: ["platform", "add-ons"],
    queryFn: () => api<AddOn[]>("platform/add-ons"),
  });
  const coupons = useQuery({
    queryKey: ["platform", "coupons"],
    queryFn: () => api<Coupon[]>("platform/coupons"),
    enabled: !pricingOnly,
  });
  const invoices = useQuery({
    queryKey: ["platform", "invoices"],
    queryFn: () => api<Invoice[]>("platform/invoices"),
    enabled: !pricingOnly,
  });
  const [addOn, setAddOn] = useState<AddOn | "new" | null>(null);
  const [coupon, setCoupon] = useState<Coupon | "new" | null>(null);
  const [action, setAction] = useState<{
    invoice: Invoice;
    kind: "mark-paid" | "refund";
  } | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["platform"] });
  return (
    <div className="space-y-6">
      {!pricingOnly && (
        <section className="card">
          <div className="card-title flex justify-between items-center">
            <h2>Invoices</h2>
            {superAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const r = await api<{
                    trialReminders: number;
                    renewalReminders: number;
                  }>("platform/jobs/billing-reminders", { method: "POST" });
                  notify(
                    `${r.trialReminders} trial and ${r.renewalReminders} renewal reminders sent.`,
                  );
                }}
              >
                Send reminders
              </Button>
            )}
          </div>
          <Table
            headers={[
              "Invoice",
              "Company",
              "Date",
              "Plan",
              "Total",
              "Status",
              "",
            ]}
            loading={invoices.isLoading}
            error={invoices.error}
            empty="No invoices yet."
            rows={(invoices.data ?? []).map((i) => [
              i.number,
              `${i.company.name} (${i.company.code})`,
              when(i.issuedAt),
              i.planCode,
              inr(i.total),
              `${i.status.toLowerCase().replace("_", " ")}${i.refundedAmount ? ` · ${inr(i.refundedAmount)} refunded` : ""}`,
              <div key="a" className="flex gap-2">
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold"
                  href={`/api/platform/invoices/${i.id}/pdf`}
                >
                  <Download size={14} /> PDF
                </a>
                {superAdmin && i.status === "ISSUED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAction({ invoice: i, kind: "mark-paid" })}
                  >
                    Mark paid
                  </Button>
                )}
                {superAdmin &&
                  ["PAID", "PARTIALLY_REFUNDED"].includes(i.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAction({ invoice: i, kind: "refund" })}
                    >
                      Refund
                    </Button>
                  )}
              </div>,
            ])}
          />
        </section>
      )}
      <section className="card">
        <div className="card-title flex justify-between items-center">
          <h2>Add-ons</h2>
          {superAdmin && (
            <Button size="sm" onClick={() => setAddOn("new")}>
              <Plus /> Add
            </Button>
          )}
        </div>
        <Table
          headers={[
            "Code",
            "Name",
            "Grants",
            "Monthly",
            "Annual",
            "Per employee",
            "Active",
            "",
          ]}
          loading={addOns.isLoading}
          empty="No add-ons."
          rows={(addOns.data ?? [])
            .filter((a) => !pricingOnly || a.public)
            .map((a) => [
              a.code,
              a.name,
              a.feature ??
                (a.extraStorageMb ? `${a.extraStorageMb} MB storage` : "—"),
              a.priceMonthly === null ? "Annual only" : inr(a.priceMonthly),
              inr(a.priceAnnual),
              a.perEmployee ? "Yes" : "No",
              a.active ? "Yes" : "No",
              superAdmin ? (
                <Button
                  key="e"
                  size="sm"
                  variant="outline"
                  onClick={() => setAddOn(a)}
                >
                  Edit
                </Button>
              ) : null,
            ])}
        />
      </section>
      {!pricingOnly && (
        <section className="card">
          <div className="card-title flex justify-between items-center">
            <h2>Coupons</h2>
            {superAdmin && (
              <Button size="sm" onClick={() => setCoupon("new")}>
                <Plus /> Add
              </Button>
            )}
          </div>
          <Table
            headers={[
              "Code",
              "Discount",
              "Plans",
              "Valid until",
              "Used",
              "Active",
              "",
            ]}
            loading={coupons.isLoading}
            empty="No coupons."
            rows={(coupons.data ?? []).map((c) => [
              c.code,
              c.percentOff !== null
                ? `${c.percentOff}%`
                : inr(c.amountOff ?? 0),
              c.planCodes.join(", ") || "All",
              c.validUntil ? when(c.validUntil) : "—",
              `${c.redemptions}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}`,
              c.active ? "Yes" : "No",
              superAdmin ? (
                <Button
                  key="e"
                  size="sm"
                  variant="outline"
                  onClick={() => setCoupon(c)}
                >
                  Edit
                </Button>
              ) : null,
            ])}
          />
        </section>
      )}
      <Dialog
        open={!!addOn}
        onOpenChange={(v) => !v && setAddOn(null)}
        title="Add-on"
      >
        {addOn && (
          <RecordForm
            initial={
              addOn === "new"
                ? { active: "true", public: "true", perEmployee: "false" }
                : {
                    ...addOn,
                    active: String(addOn.active),
                    public: String(addOn.public),
                    perEmployee: String(addOn.perEmployee),
                  }
            }
            fields={[
              { key: "code", label: "Code (A-Z, 0-9, _)", required: true },
              { key: "name", label: "Name", required: true },
              {
                key: "feature",
                label: "Module it grants (e.g. ai, biometric)",
              },
              {
                key: "priceMonthly",
                label: "Monthly price (blank for annual-only)",
                type: "number",
              },
              {
                key: "priceAnnual",
                label: "Annual price",
                type: "number",
                required: true,
              },
              {
                key: "perEmployee",
                label: "Priced per employee",
                type: "select",
                required: true,
                options: bool,
              },
              {
                key: "extraStorageMb",
                label: "Extra storage (MB)",
                type: "number",
              },
              {
                key: "active",
                label: "Available",
                type: "select",
                required: true,
                options: bool,
              },
              { key: "description", label: "Description", type: "textarea" },
              {
                key: "public",
                label: "Show in public pricing",
                type: "select",
                options: bool,
                required: true,
              },
            ]}
            onCancel={() => setAddOn(null)}
            onSave={async (v) => {
              await api(
                `platform/add-ons${addOn === "new" ? "" : `/${addOn.id}`}`,
                {
                  method: addOn === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    code: v.code.trim().toUpperCase(),
                    name: v.name,
                    description: v.description || null,
                    feature: v.feature || null,
                    priceMonthly: n(v.priceMonthly),
                    priceAnnual: Number(v.priceAnnual),
                    perEmployee: v.perEmployee === "true",
                    extraStorageMb: n(v.extraStorageMb),
                    active: v.active === "true",
                    public: v.public === "true",
                  }),
                },
              );
              setAddOn(null);
              notify("Add-on saved.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!coupon}
        onOpenChange={(v) => !v && setCoupon(null)}
        title="Coupon"
      >
        {coupon && (
          <RecordForm
            initial={
              coupon === "new"
                ? { active: "true" }
                : {
                    ...coupon,
                    planCodes: coupon.planCodes.join(", "),
                    active: String(coupon.active),
                    validUntil: coupon.validUntil?.slice(0, 10),
                  }
            }
            fields={[
              { key: "code", label: "Code", required: true },
              { key: "percentOff", label: "Percent off", type: "number" },
              { key: "amountOff", label: "Amount off (₹)", type: "number" },
              {
                key: "planCodes",
                label: "Plans (comma separated; blank = all)",
              },
              { key: "validUntil", label: "Valid until", type: "date" },
              { key: "maxRedemptions", label: "Maximum uses", type: "number" },
              {
                key: "active",
                label: "Active",
                type: "select",
                required: true,
                options: bool,
              },
              { key: "description", label: "Description" },
            ]}
            onCancel={() => setCoupon(null)}
            onSave={async (v) => {
              await api(
                `platform/coupons${coupon === "new" ? "" : `/${coupon.id}`}`,
                {
                  method: coupon === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    code: v.code.trim().toUpperCase(),
                    description: v.description || null,
                    percentOff: n(v.percentOff),
                    amountOff: n(v.amountOff),
                    planCodes: v.planCodes
                      ? v.planCodes
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean)
                      : [],
                    validUntil: v.validUntil
                      ? new Date(`${v.validUntil}T23:59:59Z`).toISOString()
                      : null,
                    maxRedemptions: n(v.maxRedemptions),
                    active: v.active === "true",
                  }),
                },
              );
              setCoupon(null);
              notify("Coupon saved.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(v) => !v && setAction(null)}
        title={
          action
            ? `${action.kind === "refund" ? "Refund" : "Record payment for"} ${action.invoice.number}`
            : ""
        }
      >
        {action && (
          <RecordForm
            fields={
              action.kind === "refund"
                ? [
                    {
                      key: "amount",
                      label: "Amount (₹)",
                      type: "number",
                      required: true,
                    },
                    {
                      key: "reason",
                      label: "Reason",
                      type: "textarea",
                      required: true,
                    },
                  ]
                : [
                    {
                      key: "reference",
                      label: "Bank reference (UTR, cheque no.)",
                      required: true,
                    },
                    { key: "method", label: "Method (e.g. BANK_TRANSFER)" },
                  ]
            }
            onCancel={() => setAction(null)}
            onSave={async (v) => {
              await api(
                `platform/invoices/${action.invoice.id}/${action.kind}`,
                {
                  method: "POST",
                  body: JSON.stringify(
                    action.kind === "refund"
                      ? { amount: Number(v.amount), reason: v.reason }
                      : {
                          reference: v.reference,
                          ...(v.method ? { method: v.method } : {}),
                        },
                  ),
                },
              );
              setAction(null);
              notify(
                action.kind === "refund"
                  ? "Refund recorded."
                  : "Payment recorded; subscription activated.",
              );
              await refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
