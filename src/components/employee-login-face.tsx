"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api-client";
import { isEmployeePortal } from "@/lib/employee-access";
import {
	completeFaceLogin,
	faceLoginCompleted,
	faceLoginKey,
} from "@/lib/face-login-session";
import { currentLocation } from "@/lib/geolocation";
import type { Me } from "@/types/ui";
import { AutoFaceScan } from "./auto-face-scan";
import { FaceRegistration } from "./face-registration";
import { Button } from "./ui/button";

type FaceStatus = {
	required: boolean;
	providerConfigured: boolean;
	enrollmentRequired: boolean;
};
export function EmployeeLoginFace({
	me,
	children,
}: {
	me: Me;
	children: ReactNode;
}) {
	if (!isEmployeePortal(me) || !me.permissions.includes("attendance.self"))
		return children;
	return (
		<LoginFace key={me.sessionId} me={me}>
			{children}
		</LoginFace>
	);
}

function LoginFace({ me, children }: { me: Me; children: ReactNode }) {
	const key = faceLoginKey(me.userId, me.sessionId);
	const [done, setDone] = useState(() => faceLoginCompleted(key));
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const client = useQueryClient();
	const status = useQuery({
		queryKey: ["face", "status", me.userId, me.sessionId],
		queryFn: () => api<FaceStatus>("face/status"),
	});
	if (!status.data && !status.error)
		return (
			<main className="p-6">
				<p role="status">Checking your face enrollment…</p>
			</main>
		);
	if (
		status.data?.required &&
		status.data.enrollmentRequired &&
		status.data.providerConfigured
	)
		return (
			<main className="min-h-screen p-6">
				<div className="max-w-xl mx-auto space-y-4">
					<h1 className="text-xl font-semibold">Welcome, {me.name}</h1>
					<p>Complete your first-login face registration to continue.</p>
					<FaceRegistration
						onEnrolled={async () => {
							await client.invalidateQueries({ queryKey: ["me"] });
							await status.refetch();
						}}
					/>
					<Button
						variant="outline"
						onClick={async () => {
							await api("auth/logout", { method: "POST" });
							window.location.href = "/login";
						}}
					>
						Sign out
					</Button>
				</div>
			</main>
		);

	return (
		<>
			{status.data?.required && !done && (
				<section className="card p-6 space-y-3 relative z-30 max-w-xl mx-auto my-4">
					<h2 className="font-semibold">Automatic face attendance</h2>
					<p>
						Your first verified scan of the workday checks you in. Later
						verified scans save your latest check-out.
					</p>
					{!status.data.providerConfigured ? (
						<p role="status">
							Face attendance is awaiting the recognition and liveness service
							connection. Contact your administrator.
						</p>
					) : (
						<AutoFaceScan
							autoStart={true}
							label="Retry attendance scan"
							onFace={async (sample) => {
								if (faceLoginCompleted(key)) {
									setDone(true);
									return true;
								}
								setError("");
								try {
									const summary = await api<{
										employeePolicy: {
											geofenceEnabled: boolean;
											gpsTrackingEnabled: boolean;
										};
									}>("time/summary");
									const policy = summary.employeePolicy;
									const location =
										policy.geofenceEnabled || policy.gpsTrackingEnabled
											? await currentLocation()
											: undefined;
									const saved = await api<{ checkOut: string | null }>(
										"time/face-punch",
										{
											method: "POST",
											body: JSON.stringify({
												faceSample: sample,
												...(location ? { location } : {}),
											}),
										},
									);
									completeFaceLogin(key);
									setMessage(
										saved.checkOut
											? "Face matched. Check-out recorded."
											: "Face matched. Check-in recorded.",
									);
									setDone(true);
									await Promise.all([
										client.invalidateQueries({ queryKey: ["time"] }),
										client.invalidateQueries({ queryKey: ["home"] }),
									]);
									return true;
								} catch (e) {
									setError((e as Error).message);
									return false;
								}
							}}
						/>
					)}
					{error && (
						<p role="alert" className="error">
							{error}
						</p>
					)}
				</section>
			)}
			{status.error && (
				<p role="alert" className="error p-4">
					{status.error.message}
				</p>
			)}
			{message && (
				<p
					role="status"
					className="card p-4 relative z-30 max-w-xl mx-auto my-4"
				>
					{message}
				</p>
			)}
			{children}
		</>
	);
}
