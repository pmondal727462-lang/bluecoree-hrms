"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { RecordForm } from "./record-form";
import { FaceCapture } from "./face-capture";
import { CompanyLogo } from "./company-logo";

export function EmployeeSetupForm() {
  const [message, setMessage] = useState(""),
    [faceSample, setFaceSample] = useState("");
  const [faceConsent, setFaceConsent] = useState(false);
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <section className="card p-8 w-full max-w-xl">
        <div className="brand p-0! mb-8">
          <CompanyLogo />
        </div>
        <h1 className="text-2xl font-bold mb-3">
          Create your employee password
        </h1>
        <p className="muted leading-6 mb-6">
          Use the one-time setup code provided by your administrator. Your
          employee code will be your login ID.
        </p>
        {message ? (
          <p
            role="status"
            className="rounded-lg p-4 bg-blue-700/10 text-blue-700"
          >
            {message}
          </p>
        ) : (
          <RecordForm
            fields={[
              { key: "companyCode", label: "Company code", required: true },
              { key: "employeeCode", label: "Employee code", required: true },
              { key: "token", label: "First-login setup code", required: true },
              {
                key: "newPassword",
                label: "Create password (12+ characters)",
                type: "password",
                required: true,
              },
            ]}
            submitLabel="Create password"
            onSave={async (values) => {
              await api("auth/employee-setup", {
                method: "POST",
                body: JSON.stringify({
                  ...values,
                  ...(faceSample ? { faceSample, faceConsent } : {}),
                }),
              });
              setMessage(
                "Password created. You can now sign in with your employee code.",
              );
            }}
          />
        )}
        {!message && (
          <div className="mt-5">
            <FaceCapture onCapture={setFaceSample} />
            <label>
              <input
                type="checkbox"
                checked={faceConsent}
                onChange={(e) => setFaceConsent(e.target.checked)}
              />{" "}
              I agree to face verification and storage of my protected biometric
              template for attendance.
            </label>
          </div>
        )}
        <Link href="/login" className="block mt-7 text-sm text-blue-700">
          ← Back to sign in
        </Link>
      </section>
    </main>
  );
}
