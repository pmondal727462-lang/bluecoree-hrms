"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { AutoFaceScan } from "./auto-face-scan";
export function FaceRegistration({
	onEnrolled,
}: {
	onEnrolled?: () => Promise<void>;
}) {
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const status = useQuery({
		queryKey: ["face", "status"],
		queryFn: () => api<{ providerConfigured: boolean }>("face/status"),
	});
	if (status.error)
		return (
			<p className="error" role="alert">
				{status.error.message}
			</p>
		);
	if (!status.data) return <p>Checking face attendance setup…</p>;
	if (!status.data.providerConfigured)
		return (
			<section className="card p-5 space-y-2">
				<h2 className="font-semibold">Face attendance setup required</h2>
				<p>
					Face verification is mandatory for check-in and check-out. The
					verification service is not connected yet. Contact the system
					administrator to complete setup.
				</p>
				<p className="muted text-sm">
					Face enrollment will be available when the service is connected.
				</p>
			</section>
		);
	return (
		<section className="card p-6 space-y-4">
			<h2 className="font-semibold">Register your face</h2>
			<p>
				Face verification is mandatory for every check-in and check-out.
				Register your face before marking attendance.
			</p>
			<label>
				<input
					type="checkbox"
					checked={consent}
					disabled={busy}
					onChange={(e) => setConsent(e.target.checked)}
				/>{" "}
				I agree to face verification and storage of my protected biometric
				template for attendance.
			</label>
			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}
			{consent && (
				<AutoFaceScan
					autoStart={true}
					label="Scan face to register"
					onFace={async (sample) => {
						setBusy(true);
						setError("");
						try {
							await api("face/enroll", {
								method: "POST",
								body: JSON.stringify({ faceSample: sample, consent }),
							});
							if (onEnrolled) await onEnrolled();
							else window.location.reload();
							return true;
						} catch (e) {
							setError((e as Error).message);
							return false;
						} finally {
							setBusy(false);
						}
					}}
				/>
			)}
		</section>
	);
}
