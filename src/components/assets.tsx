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

type Person = {
  id?: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
};
type Asset = {
  id: string;
  assetCode: string;
  category: string;
  name: string;
  brand: string | null;
  serialNumber: string | null;
  cost: number | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  vendor: string | null;
  status: string;
  condition: string;
  location: string | null;
  notes: string | null;
  assignments: {
    id: string;
    issuedOn: string;
    expectedReturnOn: string | null;
    acknowledgedAt: string | null;
    employee: Person;
  }[];
};
type History = {
  id: string;
  issuedOn: string;
  returnedOn: string | null;
  issueCondition: string;
  returnCondition: string | null;
  returnNotes: string | null;
  employee: Person;
};
type Mine = {
  id: string;
  issuedOn: string;
  returnedOn: string | null;
  acknowledgedAt: string | null;
  asset: {
    assetCode: string;
    category: string;
    name: string;
    brand: string | null;
    serialNumber: string | null;
  };
};
const categories = [
  "LAPTOP",
  "DESKTOP",
  "MONITOR",
  "MOBILE",
  "PRINTER",
  "KEYBOARD",
  "MOUSE",
  "ACCESS_CARD",
  "SIM",
  "OTHER",
];
const conditions = ["NEW", "GOOD", "FAIR", "DAMAGED"];
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const who = (p: Person) => `${p.employeeCode} · ${p.firstName} ${p.lastName}`;
const today = () => new Date().toISOString().slice(0, 10);
const options = (list: string[]) =>
  list.map((v) => ({ value: v, label: label(v) }));

export function AssetsPage({ me, notify }: { me: Me; notify: Notify }) {
  const manage = me.permissions.includes("assets.manage");
  const [tab, setTab] = useState(manage ? "register" : "mine");
  return (
    <>
      <Heading
        eyebrow="Assets"
        title="Company assets"
        text="Laptops, phones, access cards and other equipment: who has what, since when, in what condition and under what warranty."
      />
      <div className="section-tabs">
        {[
          ...(me.permissions.includes("assets.self")
            ? [["mine", "My assets"]]
            : []),
          ...(manage ? [["register", "Asset register"]] : []),
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "mine" ? (
        <MyAssets notify={notify} />
      ) : (
        <Register notify={notify} />
      )}
    </>
  );
}

function MyAssets({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: () => api<Mine[]>("assets/mine"),
  });
  return (
    <section className="card">
      <Table
        headers={["Asset", "Serial number", "Issued", "Returned", ""]}
        loading={list.isLoading}
        error={list.error}
        empty="No assets have been issued to you."
        rows={(list.data ?? []).map((a) => [
          `${a.asset.assetCode} · ${a.asset.name} (${label(a.asset.category)})`,
          a.asset.serialNumber ?? "—",
          a.issuedOn.slice(0, 10),
          a.returnedOn?.slice(0, 10) ?? "With you",
          !a.returnedOn && !a.acknowledgedAt ? (
            <Button
              key="k"
              size="sm"
              onClick={async () => {
                await api(`assets/assignments/${a.id}/acknowledge`, {
                  method: "POST",
                });
                notify("Receipt acknowledged.");
                await client.invalidateQueries({ queryKey: ["assets"] });
              }}
            >
              Acknowledge receipt
            </Button>
          ) : a.acknowledgedAt && !a.returnedOn ? (
            <span key="k" className="badge positive">
              acknowledged
            </span>
          ) : null,
        ])}
      />
    </section>
  );
}

function Register({ notify }: { notify: Notify }) {
  const client = useQueryClient();
  const [status, setStatus] = useState(""),
    [category, setCategory] = useState(""),
    [q, setQ] = useState(""),
    [warranty, setWarranty] = useState(false),
    [edit, setEdit] = useState<Asset | "new" | null>(null),
    [open, setOpen] = useState<Asset | null>(null);
  const params = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { q } : {}),
    ...(warranty ? { warrantyWithin: "60" } : {}),
  });
  const list = useQuery({
    queryKey: ["assets", "list", params.toString()],
    queryFn: () => api<Asset[]>(`assets?${params}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["assets"] });
  return (
    <section className="card">
      <div className="toolbar">
        <label>
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Code, name or serial"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["IN_STOCK", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"].map(
              (s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={warranty}
            onChange={(e) => setWarranty(e.target.checked)}
          />
          Warranty ends within 60 days
        </label>
        <Button size="sm" onClick={() => setEdit("new")}>
          <Plus />
          Add asset
        </Button>
      </div>
      <Table
        headers={[
          "Code",
          "Asset",
          "Serial",
          "Status",
          "Condition",
          "With",
          "Warranty",
          "",
        ]}
        loading={list.isLoading}
        error={list.error}
        empty="No assets match."
        rows={(list.data ?? []).map((a) => [
          a.assetCode,
          `${a.name} (${label(a.category)})`,
          a.serialNumber ?? "—",
          label(a.status),
          label(a.condition),
          a.assignments[0] ? who(a.assignments[0].employee) : "—",
          a.warrantyUntil?.slice(0, 10) ?? "—",
          <div key="a" className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(a)}>
              Manage
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEdit(a)}>
              Edit
            </Button>
          </div>,
        ])}
      />
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit === "new" ? "Add asset" : "Edit asset"}
      >
        {edit && (
          <RecordForm
            initial={
              edit === "new" ? { category: "LAPTOP", condition: "NEW" } : edit
            }
            fields={[
              { key: "assetCode", label: "Asset ID", required: true },
              {
                key: "category",
                label: "Category",
                type: "select",
                required: true,
                options: options(categories),
              },
              { key: "name", label: "Name or model", required: true },
              { key: "brand", label: "Brand" },
              { key: "serialNumber", label: "Serial number" },
              { key: "cost", label: "Cost (₹)", type: "number" },
              { key: "purchaseDate", label: "Purchase date", type: "date" },
              { key: "warrantyUntil", label: "Warranty until", type: "date" },
              { key: "vendor", label: "Vendor" },
              {
                key: "condition",
                label: "Condition",
                type: "select",
                required: true,
                options: options(conditions),
              },
              { key: "location", label: "Location" },
              { key: "notes", label: "Notes", type: "textarea" },
            ]}
            onCancel={() => setEdit(null)}
            onSave={async (v) => {
              const n = (k: string) => v[k] || null;
              await api(`assets${edit === "new" ? "" : `/${edit.id}`}`, {
                method: edit === "new" ? "POST" : "PUT",
                body: JSON.stringify({
                  assetCode: v.assetCode,
                  category: v.category,
                  name: v.name,
                  brand: n("brand"),
                  serialNumber: n("serialNumber"),
                  cost: v.cost === "" ? null : Number(v.cost),
                  purchaseDate: n("purchaseDate"),
                  warrantyUntil: n("warrantyUntil"),
                  vendor: n("vendor"),
                  condition: v.condition,
                  location: n("location"),
                  notes: n("notes"),
                }),
              });
              setEdit(null);
              notify("Asset saved.");
              await refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open ? `${open.assetCode} · ${open.name}` : ""}
      >
        {open && (
          <AssetDetail
            asset={open}
            notify={notify}
            onDone={async () => {
              setOpen(null);
              await refresh();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function AssetDetail({
  asset,
  notify,
  onDone,
}: {
  asset: Asset;
  notify: Notify;
  onDone: () => Promise<void>;
}) {
  const detail = useQuery({
    queryKey: ["assets", "detail", asset.id],
    queryFn: () => api<Asset & { history: History[] }>(`assets/${asset.id}`),
  });
  const [mode, setMode] = useState<"assign" | "return" | "status" | null>(null);
  const post = async (action: string, body: unknown, message: string) => {
    await api(`assets/${asset.id}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    notify(message);
    await onDone();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {label(asset.status)} · {label(asset.condition)}
        {asset.cost !== null &&
          ` · cost ₹${asset.cost.toLocaleString("en-IN")}`}
        {asset.purchaseDate && ` · bought ${asset.purchaseDate.slice(0, 10)}`}
      </p>
      <div className="flex gap-2 flex-wrap">
        {asset.status === "IN_STOCK" && (
          <Button size="sm" onClick={() => setMode("assign")}>
            Issue to employee
          </Button>
        )}
        {asset.status === "ASSIGNED" && (
          <Button size="sm" onClick={() => setMode("return")}>
            Record return
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setMode("status")}>
          Change status
        </Button>
      </div>
      {mode === "assign" && (
        <RecordForm
          initial={{ issuedOn: today(), condition: asset.condition }}
          fields={[
            {
              key: "employeeId",
              label: "Employee",
              type: "select",
              reference: "employees",
              required: true,
            },
            {
              key: "issuedOn",
              label: "Issue date",
              type: "date",
              required: true,
            },
            { key: "expectedReturnOn", label: "Expected return", type: "date" },
            {
              key: "condition",
              label: "Condition at issue",
              type: "select",
              required: true,
              options: options(conditions),
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ]}
          onCancel={() => setMode(null)}
          onSave={(v) =>
            post(
              "assign",
              {
                employeeId: v.employeeId,
                issuedOn: v.issuedOn,
                expectedReturnOn: v.expectedReturnOn || null,
                condition: v.condition,
                ...(v.notes ? { notes: v.notes } : {}),
              },
              "Asset issued.",
            )
          }
        />
      )}
      {mode === "return" && (
        <RecordForm
          initial={{ returnedOn: today(), condition: "GOOD" }}
          fields={[
            {
              key: "returnedOn",
              label: "Return date",
              type: "date",
              required: true,
            },
            {
              key: "condition",
              label: "Condition on return (damaged goes to repair)",
              type: "select",
              required: true,
              options: options(conditions),
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ]}
          onCancel={() => setMode(null)}
          onSave={(v) =>
            post(
              "return",
              {
                returnedOn: v.returnedOn,
                condition: v.condition,
                ...(v.notes ? { notes: v.notes } : {}),
              },
              "Return recorded.",
            )
          }
        />
      )}
      {mode === "status" && (
        <RecordForm
          fields={[
            {
              key: "status",
              label: "Status",
              type: "select",
              required: true,
              options: options(["IN_STOCK", "IN_REPAIR", "RETIRED", "LOST"]),
            },
            { key: "note", label: "Reason", type: "textarea", required: true },
          ]}
          onCancel={() => setMode(null)}
          onSave={(v) =>
            post(
              "status",
              { status: v.status, note: v.note },
              "Status changed.",
            )
          }
        />
      )}
      <div>
        <p className="subheading mb-2">History</p>
        <Table
          headers={["Employee", "Issued", "Returned", "Condition"]}
          loading={detail.isLoading}
          empty="Never issued."
          rows={(detail.data?.history ?? []).map((h) => [
            who(h.employee),
            h.issuedOn.slice(0, 10),
            h.returnedOn?.slice(0, 10) ?? "—",
            `${label(h.issueCondition)} → ${h.returnCondition ? label(h.returnCondition) : "—"}${h.returnNotes ? ` (${h.returnNotes})` : ""}`,
          ])}
        />
      </div>
    </div>
  );
}
