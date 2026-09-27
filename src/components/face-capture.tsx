"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
export function FaceCapture({ onCapture }: { onCapture: (sample: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (video.current) video.current.srcObject = stream; return () => stream?.getTracks().forEach(t => t.stop()); }, [stream]);
  async function open() { try { setError(""); setCaptured(false); onCapture(""); const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); setStream(next); } catch { setError("Camera access is required. Allow it in your browser and use HTTPS."); } }
  function capture() { if (!video.current?.videoWidth) return; const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = Math.round(640 * video.current.videoHeight / video.current.videoWidth); canvas.getContext("2d")?.drawImage(video.current, 0, 0, canvas.width, canvas.height); onCapture(canvas.toDataURL("image/jpeg", 0.7)); setCaptured(true); stream?.getTracks().forEach((track) => track.stop()); setStream(null); }
  return <div className="space-y-3"><p className="text-sm">Capture your face for attendance verification. HRMS stores an encrypted biometric template, not the camera photograph.</p>{error && <p role="alert">{error}</p>}{stream && <video ref={video} autoPlay muted playsInline className="rounded-lg max-w-xs" />}{!stream && <Button type="button" variant="outline" onClick={() => void open()}>{captured ? "Retake face" : "Open camera"}</Button>}{stream && <Button type="button" onClick={capture}>Capture face</Button>}{captured && <span className="badge positive ml-3">Face captured</span>}</div>;
}
