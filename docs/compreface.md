# CompreFace deployment

Status: application adapter implemented; live service hosting and a liveness backend are still required. Mock contract tests do not validate recognition accuracy or spoof resistance.

## Employee login attendance

After password/MFA setup, the employee workspace checks enrollment on every login, including direct links to profile, leave and payslips. With a connected provider, an employee without an active template must consent and complete automatic camera enrollment before continuing. The provider-derived template is encrypted in the server database; the raw camera image is not stored.

After enrollment, and on subsequent login sessions, the camera automatically captures one steady face and submits it to the existing liveness and identity verification flow. The first successful scan of the workday records check-in; later scans preserve that check-in and update the latest check-out. This happens once per browser login session, not on each page navigation or refresh. Employees can explicitly start another scan from Home or Attendance when leaving without logging in again. Existing GPS, geofence, lockout, replay and one-minute punch spacing rules still apply. Camera permission is required.

When the provider is unavailable or unconfigured, the workspace displays the setup error and does not manufacture attendance. Production activation still requires the HTTPS recognition and liveness services below. Browser session markers prevent routine repeated automatic scans; they are not a substitute for server-side attendance rules.

Use CompreFace 1.2.0 or newer with embedding verification support. Follow the official Docker installation: https://github.com/exadel-inc/CompreFace#installation . Run it on a separate Docker host, with persistent database storage, backups, restricted administration access and an HTTPS reverse proxy. Do not expose its database. The Vercel application calls its HTTPS API; the API keys never go to browsers.

Create one Face Detection service and one Face Verification service in CompreFace. They have different API keys. Set these server-only variables in the application's production environment:

```dotenv
FACE_PROVIDER=compreface
COMPREFACE_URL=https://your-face-api.example.com
COMPREFACE_DETECTION_KEY=your-detection-service-key
COMPREFACE_VERIFICATION_KEY=your-verification-service-key
FACE_LIVENESS_URL=https://your-liveness-api.example.com
FACE_LIVENESS_KEY=your-liveness-service-key
```

The liveness endpoint is a separate integration contract, not a built-in CompreFace endpoint or a bundled service. POST `/verify` receives JSON `{sample: "data:image/jpeg;base64,...", requestId: "..."}` and a Bearer token. It must actually evaluate spoofing and return `{requestId: "same id", livenessPassed: true|false}`. Do not implement it as an unconditional success. Providers requiring video/challenges need a corresponding capture-flow integration before use. Until a suitable service is running, enrollment and punches remain blocked.

Enrollment extracts exactly one embedding using the calculator plugin and stores it encrypted in the HR database. Punches extract a fresh embedding and compare it only with the logged-in employee's template through `/api/v1/verification/embeddings/verify`. No recognition collection or persistent photo storage is used. Configure provider/reverse-proxy logs to exclude request bodies; restrict access to biometric data and backups. HR reset deletes the application's encrypted template. If changing providers or models, reset existing face profiles and enroll again; keep the model version pinned.

Before activation: configure both services, redeploy, check employee face status, enroll with the employee's consent, test the same employee and a different person, test photo/screen spoof rejection, no-face and multiple-face rejection, and service outages. Confirm repeated punches preserve the first in and last out. Validate thresholds with real cameras before rollout.

REST contract: https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md
