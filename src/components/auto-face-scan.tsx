"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaceCapture } from "./face-capture";
import { Button } from "./ui/button";

type Detector = {
	detectForVideo: (
		video: HTMLVideoElement,
		time: number,
	) => {
		detections: {
			boundingBox?: { originX: number; width: number; height: number };
			categories: { score: number }[];
		}[];
	};
	close: () => void;
};
type State =
	| "idle"
	| "loading"
	| "scanning"
	| "verifying"
	| "done"
	| "stopped"
	| "unsupported";

// Loaded once per page; the runtime and model are served from this origin.
let detectorPromise: Promise<Detector> | null = null;
function loadDetector() {
	detectorPromise ??= (async () => {
		const { FaceDetector, FilesetResolver } = await import(
			"@mediapipe/tasks-vision"
		);
		const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
		return (await FaceDetector.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath: "/models/blaze_face_short_range.tflite",
				delegate: "CPU",
			},
			runningMode: "VIDEO",
			minDetectionConfidence: 0.6,
		})) as unknown as Detector;
	})().catch((error) => {
		detectorPromise = null;
		throw error;
	});
	return detectorPromise;
}

const steadyFrames = 3;
const maxAttempts = 3;

// Opens the camera, detects a face on the device and, once exactly one face
// is steady in view, captures a single frame and hands it to onFace. Face
// matching and liveness happen on the server. onFace returns true when the
// attendance was recorded; otherwise scanning resumes, up to three attempts.
export function AutoFaceScan({
	autoStart,
	label,
	onFace,
}: {
	autoStart: boolean;
	label: string;
	onFace: (sample: string) => Promise<boolean>;
}) {
	const video = useRef<HTMLVideoElement>(null);
	const stream = useRef<MediaStream | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
	const generation = useRef(0);
	const [state, setState] = useState<State>("idle");
	const [hint, setHint] = useState("");
	const [attempts, setAttempts] = useState(0);

	const stop = useCallback((next: State = "stopped") => {
		generation.current += 1;
		if (timer.current) clearInterval(timer.current);
		if (retry.current) clearTimeout(retry.current);
		timer.current = retry.current = null;
		stream.current?.getTracks().forEach((t) => t.stop());
		stream.current = null;
		setState(next);
	}, []);
	useEffect(() => () => stop(), [stop]);

	const capture = useCallback(() => {
		const v = video.current;
		if (!v?.videoWidth) return "";
		const canvas = document.createElement("canvas");
		canvas.width = 640;
		canvas.height = Math.round((640 * v.videoHeight) / v.videoWidth);
		canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", 0.7);
	}, []);

	const start = useCallback(
		async (attempt: number) => {
			const run = ++generation.current;
			setAttempts(attempt);
			setState("loading");
			setHint("Starting camera…");
			let detector: Detector;
			try {
				detector = await loadDetector();
			} catch {
				if (run !== generation.current) return;
				setState("unsupported");
				return;
			}
			if (run !== generation.current) return;
			try {
				const next =
					stream.current ??
					(await navigator.mediaDevices.getUserMedia({
						video: {
							facingMode: "user",
							width: { ideal: 640 },
							height: { ideal: 480 },
						},
						audio: false,
					}));
				if (run !== generation.current) {
					next.getTracks().forEach((track) => track.stop());
					return;
				}
				stream.current = next;
			} catch {
				if (run !== generation.current) return;
				setHint(
					"Camera access is required. Allow it in your browser (HTTPS is needed outside localhost).",
				);
				setState("stopped");
				return;
			}
			if (video.current) video.current.srcObject = stream.current;
			await video.current?.play().catch(() => undefined);
			if (run !== generation.current) return;
			setState("scanning");
			setHint("Look at the camera.");
			let steady = 0;
			timer.current = setInterval(async () => {
				const v = video.current;
				if (!v || v.readyState < 2) return;
				const found = detector
					.detectForVideo(v, performance.now())
					.detections.filter((d) => (d.categories[0]?.score ?? 0) >= 0.8);
				const box = found[0]?.boundingBox;
				if (found.length !== 1 || !box) {
					steady = 0;
					setHint(
						found.length > 1
							? "Only one person should be in view."
							: "Looking for your face…",
					);
					return;
				}
				if (box.width < v.videoWidth * 0.2) {
					steady = 0;
					setHint("Move a little closer.");
					return;
				}
				if (++steady < steadyFrames) {
					setHint("Hold still…");
					return;
				}
				if (timer.current) clearInterval(timer.current);
				timer.current = null;
				const sample = capture();
				setState("verifying");
				setHint("Verifying…");
				const ok = await onFace(sample).catch(() => false);
				if (run !== generation.current) return;
				if (ok) return stop("done");
				if (attempt + 1 >= maxAttempts) {
					setHint("Face could not be verified. Try again when ready.");
					return stop("stopped");
				}
				// Give the person a moment before the next automatic attempt.
				retry.current = setTimeout(() => void start(attempt + 1), 2500);
			}, 300);
		},
		[capture, onFace, stop],
	);

	useEffect(() => {
		if (autoStart && state === "idle") void start(0);
	}, [autoStart, state, start]);

	if (state === "unsupported")
		return (
			<div className="space-y-2">
				<p className="muted text-sm">
					Automatic face detection is not available in this browser. Capture
					your face manually.
				</p>
				<FaceCapture
					onCapture={(sample) => {
						if (sample) void onFace(sample);
					}}
				/>
			</div>
		);
	const active = ["loading", "scanning", "verifying"].includes(state);
	return (
		<div className="space-y-3">
			<video
				ref={video}
				autoPlay
				muted
				playsInline
				className={`rounded-lg max-w-xs ${active ? "" : "hidden"}`}
			/>
			{hint && (
				<p className="text-sm" role="status" aria-live="polite">
					{hint}
					{active && attempts > 0 ? ` (attempt ${attempts + 1} of 3)` : ""}
				</p>
			)}
			{!active && state !== "done" && (
				<Button type="button" onClick={() => void start(0)}>
					{label}
				</Button>
			)}
			{active && (
				<Button type="button" variant="outline" onClick={() => stop()}>
					Stop camera
				</Button>
			)}
			<p className="muted text-xs">
				Your face is detected on this device. One frame is sent for
				verification; HRMS stores only an encrypted template, not the photo.
			</p>
		</div>
	);
}
