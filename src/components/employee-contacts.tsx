"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";

type Contact = {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  isPrimary: boolean;
};
type Bank = {
  id: string;
  accountMasked: string;
  accountNumber: string;
  ifsc: string | null;
  bankName: string | null;
  isPrimary: boolean;
  active: boolean;
  createdAt: string;
  deactivatedAt: string | null;
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong.";

// Up to five emergency contacts. `base` is "profile" for the signed-in
// employee or "employees/<id>".
export function EmergencyContacts({
  base,
  canEdit,
  notify,
}: {
  base: string;
  canEdit: boolean;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const key = ["emergency-contacts", base];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<Contact[]>(`${base}/emergency-contacts`),
  });
  const [draft, setDraft] = useState({ name: "", relationship: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await client.invalidateQueries({ queryKey: key });
      await client.invalidateQueries({ queryKey: ["profile"] });
      notify(done);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const contacts = list.data ?? [];
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Emergency contacts</h3>
      {list.error && <p className="error">{list.error.message}</p>}
      {!contacts.length && !list.isLoading && (
        <p className="muted text-sm">No emergency contacts yet.</p>
      )}
      <ul className="space-y-2">
        {contacts.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] rounded-lg p-3"
          >
            <div>
              <p className="font-medium">
                {c.name}
                {c.isPrimary && (
                  <span className="badge positive ml-2">Primary</span>
                )}
              </p>
              <p className="muted text-sm">
                {[c.relationship, c.phone].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                {!c.isPrimary && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api(`${base}/emergency-contacts/${c.id}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              name: c.name,
                              relationship: c.relationship,
                              phone: c.phone,
                              isPrimary: true,
                            }),
                          }),
                        "Primary contact changed.",
                      )
                    }
                  >
                    Make primary
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        api(`${base}/emergency-contacts/${c.id}`, {
                          method: "DELETE",
                        }),
                      "Contact removed.",
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canEdit && contacts.length < 5 && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                api(`${base}/emergency-contacts`, {
                  method: "POST",
                  body: JSON.stringify({
                    name: draft.name,
                    relationship: draft.relationship || null,
                    phone: draft.phone || null,
                  }),
                }),
              "Contact added.",
            ).then(() => setDraft({ name: "", relationship: "", phone: "" }));
          }}
        >
          <label>
            Name *
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Relationship
            <input
              maxLength={60}
              value={draft.relationship}
              onChange={(e) =>
                setDraft({ ...draft, relationship: e.target.value })
              }
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              maxLength={20}
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={busy}>
              Add contact
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

// Salary account history, for roles with employees.sensitive.
export function BankAccounts({
  employeeId,
  canEdit,
  notify,
}: {
  employeeId: string;
  canEdit: boolean;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const key = ["bank-accounts", employeeId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<Bank[]>(`employees/${employeeId}/bank-accounts`),
  });
  const [draft, setDraft] = useState({
    accountNumber: "",
    ifsc: "",
    bankName: "",
  });
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Salary bank accounts</h3>
      {list.error && <p className="error">{list.error.message}</p>}
      {!list.data?.length && !list.isLoading && (
        <p className="muted text-sm">No bank account recorded.</p>
      )}
      <ul className="space-y-2">
        {(list.data ?? []).map((b) => (
          <li
            key={b.id}
            className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] rounded-lg p-3"
          >
            <div>
              <p className="font-medium">
                {shown === b.id ? b.accountNumber : b.accountMasked} ·{" "}
                {b.ifsc ?? "IFSC not recorded"}
                {b.active ? (
                  <span className="badge positive ml-2">Current</span>
                ) : (
                  <span className="badge ml-2">Previous</span>
                )}
              </p>
              <p className="muted text-sm">
                {b.bankName ?? "Bank not recorded"} · added{" "}
                {b.createdAt.slice(0, 10)}
                {b.deactivatedAt
                  ? ` · replaced ${b.deactivatedAt.slice(0, 10)}`
                  : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShown(shown === b.id ? null : b.id)}
            >
              {shown === b.id ? "Hide" : "Show number"}
            </Button>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(`employees/${employeeId}/bank-accounts`, {
                method: "POST",
                body: JSON.stringify({
                  accountNumber: draft.accountNumber,
                  ifsc: draft.ifsc,
                  bankName: draft.bankName || null,
                }),
              });
              setDraft({ accountNumber: "", ifsc: "", bankName: "" });
              await client.invalidateQueries({ queryKey: key });
              notify(
                "Bank account updated. The previous account is kept as history.",
              );
            } catch (error) {
              notify(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            New account number *
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6,20}"
              maxLength={20}
              autoComplete="off"
              value={draft.accountNumber}
              onChange={(e) =>
                setDraft({ ...draft, accountNumber: e.target.value.trim() })
              }
            />
          </label>
          <label>
            IFSC *
            <input
              required
              maxLength={11}
              autoComplete="off"
              value={draft.ifsc}
              onChange={(e) =>
                setDraft({ ...draft, ifsc: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Bank name
            <input
              maxLength={120}
              value={draft.bankName}
              onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={busy}>
              Replace account
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
