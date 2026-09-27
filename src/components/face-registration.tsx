"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { FaceCapture } from "./face-capture";
import { Button } from "./ui/button";
export function FaceRegistration() {
  const [sample, setSample] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className="card p-6 space-y-4"><h1>Register your face</h1><p>Your company requires face registration before employee access. Your face will be matched when marking attendance.</p><FaceCapture onCapture={setSample} /><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I agree to face verification and storage of my protected biometric template for attendance.</label>{error && <p role="alert" className="error">{error}</p>}<Button disabled={busy || !sample || !consent} onClick={async () => { setBusy(true); setError(""); try { await api("face/enroll", { method: "POST", body: JSON.stringify({ faceSample: sample, consent }) }); window.location.reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Register face</Button></section>;
}
