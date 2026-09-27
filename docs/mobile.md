# Phase 13 — Mobile app and push notifications

Checked on 27 September 2026 against the [master specification](master-specification.md) §40–41.

| Requirement | Status |
| --- | --- |
| Mobile app (React Native or Flutter; Android and iOS) | **Added:** an Expo (React Native) app in [`mobile/`](../mobile/README.md). It has screens for sign in (with the authenticator code), dashboard, GPS and face attendance, leave, approvals, payslips (PDF), expenses (with receipt), documents and policies, notifications, HR requests and profile. Tokens are kept in the device keystore, expired tokens refresh automatically, and the device is registered at sign-in. |
| Login | Implemented: `v1/auth/login` and `v1/auth/refresh`, with plan gating, device registration and deactivated-device blocking |
| Face/GPS attendance, geofence | Implemented: `v1/attendance/check-in`, `check-out`, `face-punch` (location plus camera frame), and `v1/geofence-events` |
| Leave, attendance, payslip | Implemented. **Added:** `v1/payslips/:id/pdf`. |
| Dashboard, expenses, documents, notifications, HR requests (helpdesk), approvals | **Added** `v1/home`, `v1/expenses/*`, `v1/documents/*`, `v1/notifications/*`, `v1/helpdesk/*`, `v1/training/*`, `v1/assets/*`, `v1/performance/*` and `v1/announcements`. These are aliases for the web modules, with the same permission and plan checks. `v1/approvals` lists the leave requests and expense claims the user can decide now; the user's own items are never included. |
| Push: leave approved/rejected, attendance reminder, late attendance, payslip generated, announcement, training reminder, document expiry, approval request | **Added:** a delivery adapter (`src/integrations/push.ts`) called from every notification for these events, plus missed-punch, expense and ticket updates. Expo push tokens go to the Expo push service; native tokens go to Firebase Cloud Messaging HTTP v1 (a service-account JWT, which also reaches iOS through APNs). Tokens the provider rejects are deactivated, and delivery failures never fail the action that triggered them. It is configured through `EXPO_PUSH_ENABLED` / `EXPO_ACCESS_TOKEN` and `FCM_*`. |

**Verification:** `tests/integration/mobile.test.ts` has 3 tests. They cover:
- delivery of an allowed event to both Expo and FCM, with a signed JWT assertion;
- deactivation of dead tokens;
- no push for events outside the list;
- the v1 aliases, including 404s for unknown paths and 403s for company-only scope;
- the approvals list for the manager and then finance, with none for the requester or another tenant.

**Not verified here:**
- Installing, building or running the Expo app. No mobile toolchain was available and the dependencies were not downloaded.
- Delivery through real Expo or FCM accounts.
- Device testing of the camera, GPS and notifications.
