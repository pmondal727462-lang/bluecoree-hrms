# HRMS mobile app (Expo / React Native)

Android and iOS employee app for the HRMS API (spec §40–41). It uses the versioned mobile endpoints under `/api/v1` with bearer tokens stored in the device keystore (`expo-secure-store`).

| Screen | Endpoints |
| --- | --- |
| Sign in (with authenticator code when required), device registration | `v1/auth/login`, `v1/auth/refresh` |
| Home dashboard | `v1/home` |
| Attendance: GPS check-in/out, face attendance, month history | `v1/attendance/check-in`, `check-out`, `face-punch`; `time/summary`; `v1/attendance` |
| Leave: balance, request, cancel, history | `v1/leave-balances`, `v1/leave`, `time/leave/:id` |
| Approvals: leave and expense claims | `v1/approvals`, `time/leave/:id`, `expenses/claims/:id` |
| Payslips with PDF | `v1/payslips`, `v1/payslips/:id/pdf` |
| Expenses with receipt | `v1/expenses/categories`, `v1/expenses/claims` |
| Documents and policies | `v1/documents` |
| Notifications | `v1/notifications` |
| HR requests | `v1/helpdesk` |
| Profile | `v1/profile` |
| Push notifications | `v1/push-token` (Expo push token) |

## Run

```
cd mobile
npm install
# PowerShell: set your deployed server address (no /api suffix)
$env:EXPO_PUBLIC_API_URL='https://bluecoreehr.vercel.app'
npx expo start
```

The company plan must include the `mobile` feature. Native builds use EAS (`eas build`). Set `expo.extra.eas.projectId` for push tokens.

## Employee face attendance

The app defaults to the live BlueCoreeHR server. Employees use their existing company code and employee account; secure refresh tokens keep them signed in. Employee profiles and attendance remain in the same server database as the management dashboard.

After sign-in, Attendance opens. On first use, choose **Agree and register my face** to consent to storing an encrypted face template. The front camera captures automatically after it is ready. Once enrolled, choose **Face attendance**: a new camera capture is sent for server identity and liveness verification. The first successful scan records check-in; subsequent successful scans update check-out under the server attendance rules. Every scan requires an explicit start, so navigating screens cannot repeatedly punch attendance. Camera images are resized and local temporary files are removed after preparation; templates are never saved on the phone. GPS is requested only when the employee policy requires it. Menus use the server's subscription-filtered permissions.

Face scanning stays disabled until a real face and liveness provider is configured on the server. Production currently needs that setup; an app build alone does not enable AI verification. See [provider setup](../docs/compreface.md).

To build an Android APK after signing in to your Expo account:

```powershell
cd D:\Pintu\projects\mobile
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --profile preview --platform android
```

The preview and production profiles already point to `https://bluecoreehr.vercel.app`. A signed native build and physical-device camera tests are still required before distributing the app.

## Push notifications

The server delivers to Expo push tokens when `EXPO_PUSH_ENABLED=1`; `EXPO_ACCESS_TOKEN` is optional. Native FCM tokens are delivered through Firebase HTTP v1 when `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY` are set. Tokens the provider rejects as unregistered are deactivated.

## Status

Dependencies are installed, TypeScript checks pass, and Android/iOS JavaScript bundles export successfully. Native installation and physical-device tests have not been performed in this environment. Before release, verify signed Android/iOS builds on real devices (camera, GPS, notifications, tablet layouts), add store assets and review dependency audit findings. The existing Expo SDK 53 dependencies have outstanding transitive advisories; do not treat JavaScript bundling as release certification.

## Background live tracking

Attendance includes an explicit **Agree and start location sharing** button and a Stop button. The company needs the Live Tracking add-on, enabled attendance policy and individual employee permission. The app requests foreground and background location permission, shows an Android foreground-service notification / iOS location indicator, and stops on check-out, sign-out, session expiry or server rejection. Revoking company/employee permission rejects further points. Temporary network failures skip points until a fresh location can be sent; they do not replay old GPS as live data.

Configure `EXPO_PUBLIC_API_URL` for each EAS build environment. EAS builds require HTTPS and fail if this variable is missing. `eas.json` includes preview APK and production profiles. Configure your Expo project and signing credentials, then use `eas build --profile preview --platform android`. Background tasks need a native build, not Expo Go. iOS tablet support is enabled. Stopping the app or device power restrictions can interrupt background delivery; see the [Expo Location documentation](https://docs.expo.dev/versions/latest/sdk/location/).

The employee web portal remains available on phones/tablets for jobs, activities, break capture and prepared offline punches. Those workflows do not require installing the native app.
