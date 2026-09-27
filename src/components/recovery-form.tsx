"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RecordForm } from "./record-form";
import { CompanyLogo } from "./company-logo";
export function RecoveryForm({ mode }: { mode: "reset" | "forgot" | "otp" }) {
  const [challenge, setChallenge] = useState(""),
    [message, setMessage] = useState("");
  const { data, error } = useQuery({
    queryKey: ["capabilities"],
    queryFn: () => api<{ email: boolean }>("auth/capabilities"),
  });
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <section className="card p-8 w-full max-w-xl">
        <div className="brand p-0! mb-8">
          <CompanyLogo />
        </div>
        <h1 className="text-2xl font-bold mb-3">
          {mode === "reset"
            ? "Choose a new password"
            : mode === "forgot"
              ? "Reset your password"
              : "Sign in with an email code"}
        </h1>
        <p className="muted leading-6 mb-6">
          {mode === "reset"
            ? "Use a unique password with at least 12 characters."
            : "We’ll send instructions to the email address associated with your account."}
        </p>
        {error && <div className="error">{error.message}</div>}
        {data && !data.email && mode !== "reset" ? (
          <div className="error">
            Email delivery has not been configured. Contact your administrator
            to set up SMTP.
          </div>
        ) : message && mode !== "otp" ? (
          <p
            role="status"
            className="rounded-lg p-4 bg-blue-700/10 text-blue-700"
          >
            {message}
          </p>
        ) : (
          <RecordForm
            key={`${mode}-${challenge}`}
            fields={
              mode === "reset"
                ? [
                    {
                      key: "newPassword",
                      label: "New password",
                      type: "password",
                      required: true,
                    },
                    { key: "totp", label: "Authenticator code (if enabled)" },
                  ]
                : challenge
                  ? [
                      { key: "token", label: "Email code", required: true },
                      { key: "totp", label: "Authenticator code (if enabled)" },
                    ]
                  : [
                      {
                        key: "companyCode",
                        label: "Company code",
                        required: true,
                      },
                      {
                        key: "identifier",
                        label: "Email or mobile number",
                        required: true,
                      },
                    ]
            }
            submitLabel={
              mode === "reset"
                ? "Reset password"
                : challenge
                  ? "Sign in"
                  : "Send email"
            }
            onSave={async (v) => {
              if (mode === "reset") {
                const q = new URLSearchParams(window.location.search);
                await api("auth/reset-password", {
                  method: "POST",
                  body: JSON.stringify({
                    challengeId: q.get("id"),
                    token: q.get("token"),
                    newPassword: v.newPassword,
                    ...(v.totp ? { totp: v.totp } : {}),
                  }),
                });
                window.history.replaceState({}, "", "/reset-password");
                setMessage(
                  "Your password has been reset. You can now sign in.",
                );
              } else if (challenge) {
                await api("auth/otp/verify", {
                  method: "POST",
                  body: JSON.stringify({
                    challengeId: challenge,
                    token: v.token,
                    ...(v.totp ? { totp: v.totp } : {}),
                  }),
                });
                window.location.href = "/dashboard";
              } else {
                const result = await api<{
                  challengeId: string;
                  message: string;
                }>(
                  mode === "otp" ? "auth/otp/request" : "auth/forgot-password",
                  { method: "POST", body: JSON.stringify(v) },
                );
                setMessage(result.message);
                if (mode === "otp") setChallenge(result.challengeId);
              }
            }}
          />
        )}
        {message && mode === "otp" && (
          <p className="muted mt-4 text-xs">{message}</p>
        )}
        <Link href="/login" className="block mt-7 text-sm text-blue-700">
          ← Back to sign in
        </Link>
      </section>
    </main>
  );
}
