"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Me } from "@/types/ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RecordForm } from "./record-form";
import { Heading, Table, type Notify } from "./platform";
import { readAttachment } from "./support";

type Category = {
  id: string;
  name: string;
  limitPerClaim: number | null;
  requiresReceipt: boolean;
  active: boolean;
};
type Claim = {
  id: string;
  expenseDate: string;
  amount: number;
  currency: string;
  merchant: string | null;
  description: string;
  receiptName: string | null;
  status: string;
  reviewNote: string | null;
  category: { name: string };
  employee: {
    employeeCode: string;
    firstName: string;
    lastName: string;
    userId: string | null;
  };
};
const money = (v: number, c: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: c }).format(v);
// Claims move: submitted → manager approved → approved (finance) → paid.
const label = (s: string) =>
  ({
    MANAGER_APPROVED: "manager approved",
    APPROVED: "approved by finance",
    REIMBURSED: "paid",
  })[s] ?? s.toLowerCase();
const tone = (s: string) =>
  ["APPROVED", "REIMBURSED"].includes(s)
    ? "positive"
    : ["SUBMITTED", "MANAGER_APPROVED"].includes(s)
      ? "amber"
      : "";

export function ExpensesPage({ me, notify }: { me: Me; notify: Notify }) {
  const has = (p: string) => me.permissions.includes(p);
  const tabs = [
    ...(has("expenses.self") ? [["own", "My claims"]] : []),
    ...(has("expenses.approve") ? [["team", "Team approvals"]] : []),
    ...(has("expenses.manage")
      ? [
          ["company", "All claims"],
          ["categories", "Categories"],
        ]
      : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.[0] ?? "own");
  return (
    <>
      <Heading
        eyebrow="Expenses"
        title="Expense claims"
        text="Submit expenses with receipts. Approved claims are reimbursed with the next payroll run or marked paid by finance."
      />
      <div className="section-tabs">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "categories" ? (
        <Categories notify={notify} />
      ) : (
        <Claims scope={tab} me={me} notify={notify} />
      )}
    </>
  );
}
function Claims({
  scope,
  me,
  notify,
}: {
  scope: string;
  me: Me;
  notify: Notify;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState(
      scope === "own"
        ? ""
        : scope === "team"
          ? "SUBMITTED"
          : "MANAGER_APPROVED",
    ),
    [creating, setCreating] = useState(false),
    [review, setReview] = useState<{ claim: Claim; action: string } | null>(
      null,
    );
  const list = useQuery({
    queryKey: ["expenses", scope, status],
    queryFn: () =>
      api<Claim[]>(
        `expenses/claims?scope=${scope}${status ? `&status=${status}` : ""}`,
      ),
  });
  const categories = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => api<Category[]>("expenses/categories"),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["expenses"] });
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {[
              "SUBMITTED",
              "MANAGER_APPROVED",
              "APPROVED",
              "REJECTED",
              "REIMBURSED",
              "CANCELLED",
            ].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        {scope === "own" && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New claim
          </Button>
        )}
      </div>
      <Table
        headers={[
          "Employee",
          "Date",
          "Category",
          "Amount",
          "Description",
          "Receipt",
          "Status",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No claims."
        rows={(list.data ?? []).map((c) => {
          const mine = c.employee.userId === me.userId;
          return [
            `${c.employee.employeeCode} · ${c.employee.firstName} ${c.employee.lastName}`,
            c.expenseDate.slice(0, 10),
            c.category.name,
            money(c.amount, c.currency),
            <span key="d" className="text-xs">
              {c.merchant ? `${c.merchant}: ` : ""}
              {c.description}
            </span>,
            c.receiptName ? (
              <a
                key="r"
                className="text-blue-700 underline text-xs"
                href={`/api/expenses/claims/${c.id}/receipt`}
              >
                {c.receiptName}
              </a>
            ) : (
              "—"
            ),
            <div key="s">
              <span className={`badge ${tone(c.status)}`}>
                {label(c.status)}
              </span>
              {c.reviewNote && (
                <p className="muted text-xs mt-1">{c.reviewNote}</p>
              )}
            </div>,
            <div key="a" className="flex gap-2 flex-wrap">
              {(c.status === "SUBMITTED" ||
                (c.status === "MANAGER_APPROVED" && scope === "company")) &&
                !mine &&
                scope !== "own" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => setReview({ claim: c, action: "approve" })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReview({ claim: c, action: "reject" })}
                    >
                      Reject
                    </Button>
                  </>
                )}
              {c.status === "APPROVED" && scope === "company" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReview({ claim: c, action: "reimburse" })}
                >
                  Mark paid
                </Button>
              )}
              {["SUBMITTED", "MANAGER_APPROVED"].includes(c.status) && mine && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReview({ claim: c, action: "cancel" })}
                >
                  Cancel
                </Button>
              )}
            </div>,
          ];
        })}
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New expense claim"
        description="Attach a PDF, PNG or JPEG receipt up to 2 MB."
      >
        {creating && (
          <NewClaim
            categories={(categories.data ?? []).filter((c) => c.active)}
            onDone={async () => {
              setCreating(false);
              notify("Claim submitted for approval.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(v) => !v && setReview(null)}
        title={`${review?.action ?? ""} claim`}
      >
        {review && (
          <RecordForm
            fields={[
              {
                key: "note",
                label: review.action === "reject" ? "Reason" : "Note",
                type: "textarea",
                required: review.action === "reject",
              },
            ]}
            submitLabel="Confirm"
            onCancel={() => setReview(null)}
            onSave={async (v) => {
              await api(`expenses/claims/${review.claim.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  action: review.action,
                  note: v.note ?? "",
                }),
              });
              setReview(null);
              notify("Claim updated.");
              await refresh();
            }}
          >
            <p className="mt-4 text-sm">
              {review.claim.employee.firstName} {review.claim.employee.lastName}{" "}
              · {money(review.claim.amount, review.claim.currency)} ·{" "}
              {review.claim.category.name}
            </p>
          </RecordForm>
        )}
      </Dialog>
    </section>
  );
}
function NewClaim({
  categories,
  onDone,
}: {
  categories: Category[];
  onDone: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <RecordForm
      initial={{
        expenseDate: new Date().toISOString().slice(0, 10),
        currency: "INR",
      }}
      fields={[
        {
          key: "categoryId",
          label: "Category",
          type: "select",
          required: true,
          options: categories.map((c) => ({
            value: c.id,
            label: `${c.name}${c.limitPerClaim ? ` (max ${c.limitPerClaim})` : ""}${c.requiresReceipt ? " · receipt required" : ""}`,
          })),
        },
        {
          key: "expenseDate",
          label: "Expense date",
          type: "date",
          required: true,
        },
        { key: "amount", label: "Amount", type: "number", required: true },
        { key: "currency", label: "Currency", required: true },
        { key: "merchant", label: "Merchant" },
        {
          key: "description",
          label: "Purpose",
          type: "textarea",
          required: true,
        },
      ]}
      submitLabel="Submit claim"
      onSave={async (v) => {
        await api("expenses/claims", {
          method: "POST",
          body: JSON.stringify({
            categoryId: v.categoryId,
            expenseDate: v.expenseDate,
            amount: Number(v.amount),
            currency: v.currency.toUpperCase(),
            ...(v.merchant ? { merchant: v.merchant } : {}),
            description: v.description,
            receipt: await readAttachment(file),
          }),
        });
        await onDone();
      }}
    >
      <label className="block mt-5">
        Receipt
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </RecordForm>
  );
}
function Categories({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => api<Category[]>("expenses/categories"),
  });
  const [edit, setEdit] = useState<Category | "new" | null>(null);
  return (
    <section className="card">
      <div className="card-title flex justify-between items-center">
        <h2>Categories</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await api<{ added: string[] }>(
                "expenses/categories/defaults",
                { method: "POST" },
              );
              notify(
                r.added.length
                  ? `Added ${r.added.join(", ")}.`
                  : "The standard categories already exist.",
              );
              await client.invalidateQueries({ queryKey: ["expenses"] });
            }}
          >
            Add standard categories
          </Button>
          <Button size="sm" onClick={() => setEdit("new")}>
            <Plus />
            Add category
          </Button>
        </div>
      </div>
      <Table
        headers={["Name", "Limit per claim", "Receipt", "Status", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No categories yet. Add some before employees can claim."
        rows={(list.data ?? []).map((c) => [
          c.name,
          c.limitPerClaim ?? "No limit",
          c.requiresReceipt ? "Required" : "Optional",
          c.active ? "Active" : "Inactive",
          <Button
            key="e"
            size="sm"
            variant="outline"
            onClick={() => setEdit(c)}
          >
            Edit
          </Button>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add category" : "Edit category"}
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new"
                ? { requiresReceipt: "true", active: "true" }
                : {
                    ...edit,
                    requiresReceipt: String(edit.requiresReceipt),
                    active: String(edit.active),
                  }
            }
            fields={[
              { key: "name", label: "Name", required: true },
              {
                key: "limitPerClaim",
                label: "Limit per claim (blank = none)",
                type: "number",
              },
              {
                key: "requiresReceipt",
                label: "Receipt required",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ],
              },
              {
                key: "active",
                label: "Status",
                type: "select",
                required: true,
                options: [
                  { value: "true", label: "Active" },
                  { value: "false", label: "Inactive" },
                ],
              },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              await api(
                `expenses/categories${edit === "new" ? "" : "/" + edit.id}`,
                {
                  method: edit === "new" ? "POST" : "PUT",
                  body: JSON.stringify({
                    name: v.name,
                    limitPerClaim: v.limitPerClaim
                      ? Number(v.limitPerClaim)
                      : null,
                    requiresReceipt: v.requiresReceipt === "true",
                    active: v.active === "true",
                  }),
                },
              );
              setEdit(null);
              notify("Category saved.");
              await client.invalidateQueries({ queryKey: ["expenses"] });
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
