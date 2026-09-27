# Phase 5 — AI face attendance

Checked on 27 September 2026 against the [master specification](master-specification.md) §17. Operating rules for scanning are in [phase2.md](phase2.md#face-attendance).

| §17 requirement | Status | Where |
| --- | --- | --- |
| Camera → face detection | Implemented: MediaPipe detection on the device, automatic capture of one frame | `auto-face-scan.tsx` |
| Liveness, anti-spoofing, face verification, identification | Delegated to the configured face provider (`FACE_PROVIDER_URL`/`FACE_PROVIDER_KEY`), with liveness required on every request. **Added:** server-side replay rejection; a frame already submitted is refused. | `face/service.ts`, punch |
| GPS → geofence → attendance rules → check-in | Implemented: face punches pass the same location checks and rule engine | `time/service.ts` |
| Face enrolment | Implemented with explicit consent; **added** HR reset so an employee can enrol again | Attendance → Face |
| Confidence threshold | Implemented (policy, 0.50–0.99) | Time settings |
| Failed attempts | **Added:** lockout after N failed scans within M minutes (defaults 5 and 15) | policy `faceMaxFailedAttempts`, `faceLockoutMinutes` |
| Verification logs | Implemented; **added** HR view with result, reason, confidence, liveness, device and IP | Attendance → Face |
| No unnecessary raw images; protected templates | Implemented: no photo is stored; templates are AES-GCM encrypted and never returned; reset deletes the template | `face_profiles` |
| Face not the only method; fallback per company policy | **Added:** policy `faceFallback` — `NONE` (missed-punch request or HR entry) or `WEB` (web/GPS attendance labelled **Face fallback**) | Time settings, attendance card |

Migration `20260930070000_face_lockout_fallback` adds the policy columns and `face_verification_logs.sampleHash`.

**Still required outside the code:** a face-verification provider with certified liveness and anti-spoofing, and device testing on the phones and browsers employees will use. The provider contract is `POST {FACE_PROVIDER_URL}/enroll|verify` returning `{ requestId, template?, confidence, livenessPassed, status }` over HTTPS.

**Verification:** `tests/integration/face.test.ts` (simulated provider) covers lockout, replay rejection, fallback only when the policy allows it, and HR views and reset, with permission and tenant checks.
