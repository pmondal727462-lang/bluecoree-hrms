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
# set expo.extra.apiUrl in app.json to the HRMS server (HTTPS)
npx expo start
```

The company plan must include the `mobile` feature. Native builds use EAS (`eas build`). Set `expo.extra.eas.projectId` for push tokens.

## Push notifications

The server delivers to Expo push tokens when `EXPO_PUSH_ENABLED=1`; `EXPO_ACCESS_TOKEN` is optional. Native FCM tokens are delivered through Firebase HTTP v1 when `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY` are set. Tokens the provider rejects as unregistered are deactivated.

## Status

This app is a source scaffold. It was **not installed, built or run on a device** in this environment: there was no Android or iOS toolchain, and the dependencies were not downloaded. Before release:
- run `npm install` and `npm run typecheck`;
- test on real devices (camera, GPS, notifications);
- add store assets.
