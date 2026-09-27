# Phase 4 — Biometric device integration

Checked and built on 27 September 2026 against the [master specification](master-specification.md) §18 (and the device limit in §48). Before this pass, only a generic "BIOMETRIC" integration category and the device CSV import existed.

## Requirement status

| Spec §18 | Status | Where |
| --- | --- | --- |
| ZKTeco | Implemented: ADMS ("iclock") push protocol | `/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd` |
| eSSL | Implemented: same ADMS protocol (eSSL terminals use it) | as above |
| Hikvision | Implemented: ISAPI event notification (HTTP listening) push, JSON or multipart | `/api/biometric/hikvision/<token>` |
| Suprema | Implemented: BioStar 2 REST pull (login, event search, authentication-success events) | `pullBiostar` |
| Other devices | Implemented: generic JSON push with a device token, for other terminals or a local connector agent | `POST /api/biometric/push` |
| Device → connector → sync service → attendance API → engine | Implemented | `connectors.ts` → `sync.ts` → attendance rule engine |
| Device registration | Implemented | Attendance → Devices, `POST /api/biometric/devices` |
| Device status | Implemented: online, offline, never connected, error, inactive; last contact, sync and punch | device list |
| Employee mapping | Implemented: company-wide device user ID → employee, plus optional automatic match with employee ID; unmapped IDs listed for quick mapping | `/api/biometric/mappings`, `/api/biometric/unmapped` |
| Punch synchronization | Implemented: raw punches stored, de-duplicated and applied to attendance | `device_punches` |
| Manual sync | Implemented: BioStar pulls now; ADMS terminals are sent a "resend logs" command; waiting punches are reprocessed | `POST /api/biometric/devices/:id/sync` |
| Scheduled sync | Implemented: `npm run biometric:sync` pulls due devices and retries waiting punches | `scripts/biometric-sync.ts` |
| Sync logs | Implemented: one row per push, manual, scheduled or retry run with received, inserted, applied, unmapped, duplicate and failed counts | `device_sync_logs` |
| Failed sync retry | Implemented: failed punches retry with backoff (up to 8 attempts, then manual retry); unmapped punches are applied when mapped | `POST /api/biometric/punches/retry` |
| Device limit per plan (§48) | Implemented: `deviceLimit` on plans, enforced when registering or activating | Super Admin plan editor |

## How punches become attendance

Each device punch is stored exactly once: duplicates by device, user ID and time are skipped. It is then applied in the company's attendance lock, the same lock used by web, mobile and face punches.

1. **Employee.** The device user ID is matched through the mapping, or to the employee ID when **auto-match** is on. Unmatched punches wait as `UNMAPPED`.
2. **Work date and shift.** These come from the attendance planner, so a rostered or overnight shift is used.
3. **Check-in and check-out.** The first punch of the work day is the check-in and the latest is the check-out. Punches within a minute of each other count as one. Punches arriving late or out of order widen the day to its earliest and latest times. The rule engine then recalculates late, early exit, half day, overtime and off-day work.
4. **Stale open days.** If an earlier day is still open, its check-out was missed: it is closed with no hours as **Missed punch**. The employee can submit a missed-punch request for it; HR approval sets the times, and rejection marks it Absent.
5. **Days not changed.** Days entered or corrected by HR, marked absent, or awaiting review are left alone; those punches are `IGNORED`. Punches on approved leave, before joining, or for inactive employees are `REJECTED` with a reason.
6. **Punch log.** Every applied punch is also written to `attendance_punches` with source **Biometric** and the device serial.

Device times are local wall-clock times. They are converted with the device's time zone, or the company's when none is set.

## Connecting devices

- **ZKTeco / eSSL (ADMS).** On the terminal, open *Comm → Cloud Server Setting* and set the server address to this host with HTTPS on port 443; the terminal calls `/iclock/cdata`. The terminal identifies itself only by its serial number, so:
  - register the exact serial;
  - set an IP allow-list;
  - or keep the terminals on a private network or VPN.
- **Hikvision.** Set the HTTP listening (event notification) URL to `https://<host>/api/biometric/hikvision/<token>`. The token is shown once and can be rotated. This path needs no session or `Origin` header.
- **Generic push.** Send `POST /api/biometric/push` with `Authorization: Bearer <token>` and a body like `{"punches":[{"deviceUserId":"1001","punchedAt":"2026-09-14 09:02:10"}]}`, up to 1,000 punches per request.
- **Suprema BioStar 2.** Enter the BioStar server's public HTTPS URL, login and password; the password is stored encrypted. The BioStar device ID must equal the registered serial. Private or local addresses are refused. Use generic push through a local agent for servers that are only on a LAN.
- **Scheduling.** Run `npm run biometric:sync` every 5 minutes (Task Scheduler or cron). Push devices do not need it for new punches, but it retries failures and pulls BioStar.

## Security

- **Tenant scoping.** Device tables are company-scoped with composite foreign keys and row-level security. Push endpoints resolve the device in system scope, then work in that company's tenant scope.
- **Credentials.** BioStar passwords are encrypted, push tokens are stored only as hashes, and API responses never include either.
- **Push endpoints** are rate limited per device, require an active device and the plan's `biometric` feature, and check the optional IP allow-list.
- **Permissions and audit.** Registration, updates, token rotation, sync and mappings need `time.configure`; viewing needs `attendance.read`. Changes are audited.

## Not verified / still open

- **Real hardware.** The connectors follow the vendor protocols (ZKTeco/eSSL ADMS push, Hikvision ISAPI event notification, BioStar 2 REST) but have not been tested against real terminals. Firmware variants differ; test one device of each model before rollout.
- **Direct LAN access** to ZKTeco (TCP 4370 SDK) or pulling from Hikvision is not implemented. Cloud servers cannot reach devices on a customer LAN; use ADMS or event push, or a local agent with generic push.
- **User enrolment.** Pushing employee templates, faces or cards to devices is not implemented; enrolment is done on the device.
- **Queue workers.** The scheduled job is a script, not a BullMQ worker; queue workers belong to Phase 18.

## Verification

- 33 migrations applied.
- Type checking and lint (162 files) passed.
- 65 unit tests passed, including 5 connector parser/pull tests.
- 119 integration tests passed. The new `tests/integration/biometric.test.ts` covers:
  - registration, tenant isolation and unique serials;
  - ADMS handshake and upload with first/last punches, de-duplication and late earlier punches;
  - unmapped punches applied on mapping;
  - missed-punch closing and regularization;
  - HR-corrected days left alone;
  - the manual-sync resend command;
  - generic and Hikvision push with token checks;
  - the IP allow-list.
- The RLS test covers the new tables.
- The production build and HTTP smoke passed.
