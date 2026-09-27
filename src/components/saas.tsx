"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { RecordForm } from "./record-form";
import { Heading, Table, when, type Notify } from "./platform";
import { BillingPanel } from "./billing";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number | null;
  currency: string;
  employeeLimit: number | null;
  adminLimit: number | null;
  storageLimitMb: number | null;
  apiCallLimitMonthly: number | null;
  aiRequestLimitMonthly: number | null;
  features: string[];
  trialDays: number | null;
};
type Current = {
  plan: {
    code: string;
    name: string;
    description: string | null;
    features: string[];
  };
  status: string;
  endsAt: string | null;
  graceEndsAt: string | null;
  limits: Record<string, number | null>;
  usage: Record<string, number>;
};
export const featureLabels: Record<string, string> = {
  attendance: "Attendance & leave",
  payroll: "Payroll",
  ai: "AI HR Copilot",
  mobile: "Mobile app",
  biometric: "Biometric import",
  reports: "Reports & dashboard",
  api: "API, webhooks & integrations",
  whitelabel: "White-label branding",
  recruitment: "Recruitment / ATS",
  performance: "Performance management",
  expenses: "Expense management",
  onboarding: "Onboarding",
  face: "Face attendance",
  training: "Training",
  assets: "Assets",
};
const usageRows: [string, string, string][] = [
  ["employees", "employees", "Active employees"],
  ["admins", "admins", "Administrators"],
  ["storageMb", "storageMb", "Storage (MB)"],
  ["apiCalls", "apiCalls", "API calls this month"],
  ["aiRequests", "aiRequests", "AI requests this month"],
];
const price = (p: Plan & { pricePerEmployeeMonthly?: number | null }) =>
  p.pricePerEmployeeMonthly
    ? `${new Intl.NumberFormat("en-IN", { style: "currency", currency: p.currency }).format(p.pricePerEmployeeMonthly)} per employee/month${p.priceMonthly ? ` + ${p.priceMonthly}/month` : ""}`
    : p.priceMonthly === null
      ? "Contact us"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: p.currency,
        }).format(p.priceMonthly) + "/month";

export function SubscriptionBanner({ me }: { me: Me }) {
  const s = me.subscription;
  if (!s || s.status === "ACTIVE") return null;
  const date = (v: string | null) =>
    v ? new Date(v).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "";
  const text =
    s.status === "TRIAL"
      ? `Free trial ends on ${date(s.endsAt)}.`
      : s.status === "GRACE"
        ? `Your subscription ended on ${date(s.endsAt)}. Paid modules stop on ${date(s.graceEndsAt)} unless it is renewed.`
        : "Your subscription has expired. Paid modules are paused; your data is kept. Renew to restore access.";
  return (
    <div
      role="status"
      className={`mb-6 rounded-lg border p-4 text-sm ${s.status === "EXPIRED" ? "error" : "border-[var(--border)]"}`}
    >
      {text}{" "}
      {me.permissions.includes("company.read") && (
        <a className="text-blue-700 underline" href="/subscription">
          View subscription
        </a>
      )}
    </div>
  );
}

export function SubscriptionPage({ me, notify }: { me: Me; notify: Notify }) {
  const [tab, setTab] = useState("plan");
  const data = useQuery({
    queryKey: ["subscription"],
    queryFn: () =>
      api<{
        current: Current | null;
        plans: (Plan & Parameters<typeof BillingPanel>[0]["plans"][number])[];
        addOns: Parameters<typeof BillingPanel>[0]["addOns"];
        billing: Parameters<typeof BillingPanel>[0]["billing"];
      }>("subscription"),
  });
  const c = data.data?.current;
  return (
    <>
      <Heading
        eyebrow="Account"
        title="Subscription & branding"
        text="Your plan, usage against its limits, and white-label settings."
      />
      <div className="section-tabs">
        {[
          ["plan", "Subscription"],
          ...(me.permissions.includes("company.write")
            ? [["branding", "Branding"]]
            : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {data.error && <div className="error">{data.error.message}</div>}
      {tab === "branding" ? (
        <BrandingSettings notify={notify} />
      ) : (
        c && (
          <>
            <section className="card p-6 mb-6">
              <p className="eyebrow mb-2">Current plan</p>
              <h2 className="text-xl font-bold">
                {c.plan.name}{" "}
                <span
                  className={`badge ${["ACTIVE", "TRIAL"].includes(c.status) ? "positive" : "amber"}`}
                >
                  {c.status}
                </span>
              </h2>
              <p className="muted mt-2">
                {c.endsAt
                  ? `${c.status === "TRIAL" ? "Trial ends" : "Current period ends"} ${when(c.endsAt)}${c.graceEndsAt ? ` · grace period until ${when(c.graceEndsAt)}` : ""}`
                  : "No end date."}
              </p>
              <p className="mt-4 text-sm">
                Includes:{" "}
                {c.plan.features.map((f) => featureLabels[f] ?? f).join(", ")}
              </p>
              <p className="muted text-xs mt-4">
                Buy, renew or add modules below. When a subscription expires,
                paid modules are paused and company data is kept.
              </p>
            </section>
            <BillingPanel
              plans={data.data?.plans ?? []}
              addOns={data.data?.addOns ?? []}
              billing={
                data.data?.billing ?? {
                  gstin: null,
                  billingState: null,
                  billingEmail: null,
                  address: null,
                }
              }
              currentPlan={c.plan.code}
              canBuy={me.permissions.includes("company.write")}
              notify={notify}
            />
            <section className="card mb-6">
              <div className="card-title">
                <h2>Usage</h2>
              </div>
              <Table
                headers={["Measure", "Used", "Plan limit"]}
                empty=""
                rows={usageRows.map(([u, l, label]) => [
                  label,
                  c.usage[u] ?? 0,
                  c.limits[l] ?? "Unlimited",
                ])}
              />
            </section>
            <section className="card">
              <div className="card-title">
                <h2>Plans</h2>
              </div>
              <Table
                headers={["Plan", "Price", "Employees", "Admins", "Modules"]}
                empty="No plans available."
                rows={(data.data?.plans ?? []).map((p) => [
                  <div key="n">
                    <div className="font-semibold">
                      {p.name}{" "}
                      {p.code === c.plan.code && (
                        <span className="badge positive">Current</span>
                      )}
                    </div>
                    <span className="muted text-xs">{p.description}</span>
                  </div>,
                  price(p),
                  p.employeeLimit ?? "Unlimited",
                  p.adminLimit ?? "Unlimited",
                  <span key="f" className="text-xs">
                    {p.features.map((f) => featureLabels[f] ?? f).join(", ")}
                  </span>,
                ])}
              />
            </section>
          </>
        )
      )}
    </>
  );
}

type BrandingData = {
  enabled: boolean;
  settings:
    | (Record<string, string | null> & {
        hasLogo: boolean;
        domainVerifiedAt: string | null;
        domainToken?: string | null;
      })
    | null;
};
function BrandingSettings({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["branding"],
    queryFn: () => api<BrandingData>("branding"),
  });
  const [uploading, setUploading] = useState(false);
  if (!data.data)
    return <div className="empty">{data.error?.message ?? "Loading…"}</div>;
  if (!data.data.enabled)
    return (
      <div className="card p-6">
        White-label branding is available on plans that include it (Enterprise
        by default).
      </div>
    );
  const s = data.data.settings;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["branding"] });
    await client.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <>
      <section className="card p-6 mb-6">
        <RecordForm
          initial={s ?? {}}
          fields={[
            { key: "brandName", label: "Brand name" },
            { key: "portalTitle", label: "Portal title (browser tab)" },
            { key: "primaryColor", label: "Primary colour (#rrggbb)" },
            { key: "secondaryColor", label: "Secondary colour (#rrggbb)" },
            {
              key: "customDomain",
              label: "Custom domain (e.g. hr.example.com)",
            },
            {
              key: "loginMessage",
              label: "Login page message",
              type: "textarea",
            },
            { key: "emailFooter", label: "Email footer", type: "textarea" },
            { key: "payslipFooter", label: "Payslip footer", type: "textarea" },
          ]}
          onSave={async (v) => {
            const val = (k: string) => (v[k]?.trim() ? v[k].trim() : null);
            await api("branding", {
              method: "PUT",
              body: JSON.stringify({
                brandName: val("brandName"),
                portalTitle: val("portalTitle"),
                primaryColor: val("primaryColor"),
                secondaryColor: val("secondaryColor"),
                customDomain: val("customDomain"),
                loginMessage: val("loginMessage"),
                emailFooter: val("emailFooter"),
                payslipFooter: val("payslipFooter"),
              }),
            });
            notify("Branding saved.");
            await refresh();
          }}
        />
      </section>
      <section className="card p-6 mb-6 space-y-4">
        <h2 className="font-semibold">Logo</h2>
        <p className="muted text-sm">
          PNG or JPEG, up to 256 KB.{" "}
          {s?.hasLogo ? "A logo is set." : "No logo yet."}
        </p>
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={uploading}
            className="max-w-xs"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const r = new FileReader();
                  r.onload = () => resolve(String(r.result));
                  r.onerror = () =>
                    reject(new Error("Could not read the file."));
                  r.readAsDataURL(file);
                });
                await api("branding/logo", {
                  method: "POST",
                  body: JSON.stringify({ dataUrl }),
                });
                notify("Logo uploaded.");
                await refresh();
              } catch (err) {
                notify((err as Error).message);
              } finally {
                setUploading(false);
                e.target.value = "";
              }
            }}
          />
          {s?.hasLogo && (
            <Button
              variant="outline"
              onClick={async () => {
                await api("branding/logo", { method: "DELETE" });
                await refresh();
              }}
            >
              Remove logo
            </Button>
          )}
        </div>
      </section>
      {s?.customDomain && (
        <section className="card p-6 space-y-3">
          <h2 className="font-semibold">Custom domain</h2>
          {s.domainVerifiedAt ? (
            <p className="text-sm">
              {s.customDomain} verified {when(s.domainVerifiedAt)}. Point it to
              this application (CNAME or proxy) and add it to your TLS
              certificate; the login page then shows your branding
              automatically.
            </p>
          ) : (
            <>
              <p className="text-sm">
                Add a DNS TXT record <code>_hrms-verify.{s.customDomain}</code>{" "}
                with the value{" "}
                <code className="break-all">{s.domainToken}</code>, then verify.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api("branding/domain/verify", { method: "POST" });
                    notify("Domain verified.");
                    await refresh();
                  } catch (err) {
                    notify((err as Error).message);
                  }
                }}
              >
                Verify domain
              </Button>
            </>
          )}
        </section>
      )}
    </>
  );
}
