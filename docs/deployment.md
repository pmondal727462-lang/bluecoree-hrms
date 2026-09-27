# Deployment and operations (Phase 18)

This guide covers running the HRMS in production: containers, database roles, TLS (including white-label domains), the background worker, monitoring and releases.

## Components

| Component | What it runs |
| --- | --- |
| `app` | The Next.js web app and API (`next start`), stateless. It can run as several replicas behind the proxy. |
| `worker` | Scheduled and background jobs (`npm run worker`) from the same image. With `REDIS_URL` the jobs are BullMQ repeatable jobs: one schedule shared by all workers, 3 attempts with exponential backoff, and completed and failed jobs kept for inspection. Without Redis, an in-process cron scheduler runs them; use **one** worker process in that mode. |
| `db` | PostgreSQL 18. Row-level security is enforced for the application role. |
| `redis` | The BullMQ queue (append-only persistence). |
| `caddy` | HTTPS with automatic certificates for the main domain, and on-demand certificates for verified white-label domains (it asks `/api/public/domain-check`). |

## Scheduled jobs

All times are UTC (IST is UTC+5:30). Every job is idempotent. To run one now: `npm run job -- <name>`.

| Job | Schedule | Work |
| --- | --- | --- |
| `webhooks` | every minute | Delivers due webhooks and retries failures |
| `biometric-sync` | every 5 minutes | Pulls BioStar devices, retries unmatched punches |
| `training-reminders` | hourly at :15 | Session reminders a day ahead, certificate expiry notices |
| `greetings` | hourly | Birthday and work-anniversary greetings on each company's local date (once a day) |
| `stale-payments` | hourly at :45 | Closes online orders left unpaid for 7 days |
| `billing-reminders` | 00:30 | Trial-ending (3 days) and renewal-due (7 days) reminders |
| `document-expiry` | 01:30 | Notices 30, 7 and 1 day before a document expires |
| `leave-year-end` | 02:00 | Leave carry-forward during the first week of January (company local date) |
| `backup-daily` | 20:30 (02:00 IST) | Encrypted, verified full backup |
| `backup-weekly` | Sunday 21:00 | Weekly backup with a restore test |
| `retention` | 21:30 | Applies enabled data-retention policies (skipped under a legal hold) |
| `ai-retention` | 22:00 | Purges AI conversations, logs and drafts past their retention |

Leave accrual needs no job, because balances are computed from accrual rules on demand. Payroll is processed only by people, following the approval workflow.

## First deployment (Docker Compose)

1. Copy `.env.example` to `.env`. Run `npm run env:init` (or generate the values yourself) for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY` and `SETUP_TOKEN`. Point the database URLs at host `db`:
   - `DATABASE_URL` is the owner used for migrations;
   - `APP_DATABASE_URL` is the application role, subject to RLS;
   - `SYSTEM_DATABASE_URL` is the system role, which bypasses RLS and is used only by the platform and jobs.

   Set `POSTGRES_PASSWORD`, `APP_URL=https://<APP_DOMAIN>`, `APP_DOMAIN` and `ACME_EMAIL`. Keep a copy of `ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` outside the server; without them, data and backups cannot be read.
2. `docker compose build`, then `docker compose up -d db redis`.
3. Run the migrations and create the runtime roles:
   `docker compose run --rm app npm run db:migrate`, then `docker compose run --rm app npm run db:roles`.
4. `docker compose up -d`. Open `https://<APP_DOMAIN>/setup` and complete the one-time setup with `SETUP_TOKEN`. This creates the provider company and the Super Admin.
5. In Platform → Plans and Billing, set prices, add-ons, GST and the supplier details. The `BILLING_SUPPLIER_*` variables are printed on invoices.
6. Optional integrations are configured by environment variable (see `.env.example`):
   - SMTP;
   - Razorpay, with the webhook URL `https://<APP_DOMAIN>/api/billing/razorpay/webhook`;
   - the AI provider and the face provider;
   - FCM or Expo push;
   - SMS and WhatsApp;
   - object storage (`STORAGE_*`).

Without Docker, the same steps apply: `npm ci`, `npm run build`, `npm run db:migrate`, `npm run db:roles`, then run `npm start` and `npm run worker` under a process manager such as systemd or pm2, behind a TLS proxy.

## White-label domains

A company adds its domain in Branding and creates the TXT record `_hrms-verify.<domain>`. It points a CNAME for the domain at `APP_DOMAIN`, then clicks Verify. After that, Caddy issues a certificate on the first request, and only for verified domains of companies that still have white label. See [white-label](white-label.md).

## Releases

- The CI workflow (`.github/workflows/ci.yml`) runs on every push and pull request:
  - it migrates a fresh PostgreSQL 18 database and creates the roles;
  - it runs lint, type checks, unit tests, integration tests and the production build;
  - it reports `npm audit`;
  - it builds the Docker image.
- To release:
  1. Take a manual backup: `npm run backup -- manual`.
  2. Deploy the new image.
  3. Run `npm run db:migrate`. Migrations are additive and forward-only.
  4. Restart `app` and `worker`.
  5. Run `npm run` smoke checks (`scripts/smoke.ts`) against the environment.
- Roll back by redeploying the previous image. If a migration must be undone, restore the pre-release backup into a new database and switch to it. See [backup-recovery](backup-recovery.md).

## Monitoring and alerting

- **Health:** `GET /api/health` returns 200 only when the database answers. The container `HEALTHCHECK` and uptime monitors should use it.
- **Platform health:** Platform → System health shows database, email, storage, AI, backup and integration status with history. Platform → Backups shows the last backup and its verification.
- **Logs:** structured JSON (pino) on stdout covering API requests (method, path, duration), errors, authentication, jobs (`Job finished` / `Job failed` with duration) and integration errors. Secrets, passwords and tokens are redacted. Ship stdout to your log platform (for example Loki, CloudWatch or Datadog).
- **Alert on:**
  - `/api/health` failing;
  - any `Job failed` for `backup-daily` or `backup-weekly`;
  - repeated `Job failed` for `webhooks` or `biometric-sync`;
  - 5xx rates above your baseline;
  - `Push failed` or `Notification message failed` bursts;
  - disk usage of the database and backup volumes.
- **Queue:** BullMQ keeps the last 200 completed and 500 failed jobs in Redis. Inspect them with any BullMQ dashboard (not bundled).

## Scale

Every list endpoint is paginated or capped, and filtered by company in the database, which enforces RLS. Heavy work (sync, webhooks, reminders, retention, backups) runs in the worker, not in requests.
- **App:** add replicas behind Caddy.
- **Worker:** add workers with Redis.
- **Database:** size PostgreSQL for about 1 GB per 1,000 employees per year of attendance, and test with your own data volume; see the load-testing note in the implementation audit.

## Not verified here

The Docker image, Compose stack, Caddy TLS and the GitHub Actions workflow were written but not executed in this environment, because Docker and GitHub runners were not available. Before production:
- run `docker compose build`;
- run the CI workflow once;
- load-test with production-sized data.
