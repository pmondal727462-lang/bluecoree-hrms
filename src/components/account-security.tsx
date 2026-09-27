"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "./ui/button";
import { RecordForm } from "./record-form";
import { Dialog } from "./ui/dialog";
export function AccountSecurity({
  changePasswordOnOpen = false,
}: {
  changePasswordOnOpen?: boolean;
}) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["2fa"],
    queryFn: () => api<{ enabled: boolean }>("auth/2fa/status"),
  });
  const [mode, setMode] = useState<"password" | "2fa" | null>(
      changePasswordOnOpen ? "password" : null,
    ),
    [secret, setSecret] = useState(""),
    [password, setPassword] = useState("");
  return (
    <section className="card mt-6">
      <div className="card-title">
        <h2>Password & two-factor authentication</h2>
      </div>
      <div className="p-6 space-y-6">
        {error && <div className="error">{error.message}</div>}
        <div className="flex justify-between gap-4 items-center">
          <div>
            <h3 className="text-sm font-semibold">Password</h3>
            <p className="muted text-xs mt-2">
              Changing your password signs out all devices.
            </p>
          </div>
          <Button variant="outline" onClick={() => setMode("password")}>
            Change password
          </Button>
        </div>
        <div className="flex justify-between gap-4 items-center">
          <div>
            <h3 className="text-sm font-semibold">Authenticator app</h3>
            <p className="muted text-xs mt-2">
              {data?.enabled
                ? "Enabled. A code is required when you sign in."
                : "Add a second verification step to your account."}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => {
              setMode("2fa");
              setSecret("");
              setPassword("");
            }}
          >
            {data?.enabled ? "Disable 2FA" : "Set up 2FA"}
          </Button>
        </div>
      </div>
      <Dialog
        open={mode !== null}
        onOpenChange={(v) => {
          if (!v) setMode(null);
        }}
        title={
          mode === "password"
            ? "Change password"
            : data?.enabled
              ? "Disable two-factor authentication"
              : "Set up authenticator app"
        }
        description={
          mode === "password"
            ? "Use a unique password of at least 12 characters."
            : "Keep access to your authenticator app. Enter a fresh code for each verification."
        }
      >
        {mode === "password" ? (
          <RecordForm
            fields={[
              {
                key: "currentPassword",
                label: "Current password",
                type: "password",
                required: true,
              },
              {
                key: "newPassword",
                label: "New password",
                type: "password",
                required: true,
              },
            ]}
            onSave={async (v) => {
              await api("auth/password", {
                method: "PUT",
                body: JSON.stringify(v),
              });
              window.location.href = client.getQueryData<{
                isSuperAdmin: boolean;
              }>(["me"])?.isSuperAdmin
                ? "/owner/login"
                : "/login";
            }}
          />
        ) : secret ? (
          <>
            <p className="text-sm muted mb-3">
              Add an account in your authenticator using this setup key
              (time-based, 6 digits):
            </p>
            <code className="block p-4 rounded-lg bg-[var(--muted)] break-all select-all mb-5">
              {secret}
            </code>
            <RecordForm
              key="confirm"
              fields={[
                { key: "code", label: "Authenticator code", required: true },
              ]}
              onSave={async (v) => {
                await api("auth/2fa/enable", {
                  method: "POST",
                  body: JSON.stringify({ password, code: v.code }),
                });
                await client.invalidateQueries({ queryKey: ["2fa"] });
                setMode(null);
                setSecret("");
                setPassword("");
              }}
            />
          </>
        ) : (
          <RecordForm
            key={data?.enabled ? "disable" : "setup"}
            fields={[
              {
                key: "password",
                label: "Current password",
                type: "password",
                required: true,
              },
              ...(data?.enabled
                ? [{ key: "code", label: "Authenticator code", required: true }]
                : []),
            ]}
            onSave={async (v) => {
              if (data?.enabled) {
                await api("auth/2fa/disable", {
                  method: "POST",
                  body: JSON.stringify(v),
                });
                await client.invalidateQueries({ queryKey: ["2fa"] });
                setMode(null);
              } else {
                const result = await api<{ secret: string }>("auth/2fa/setup", {
                  method: "POST",
                  body: JSON.stringify(v),
                });
                setSecret(result.secret);
                setPassword(v.password);
              }
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
