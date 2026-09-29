# Vercel deployment

The Next.js app and API can run on Vercel. PostgreSQL, private uploads, and the background worker need separate hosted services. The local database at localhost:55432 and files under `data/` cannot be used by a cloud deployment.

## Project

- Repository: `pmondal727462-lang/bluecoree-hrms`
- Root directory: repository root (`./`)
- Framework: Next.js
- Node.js: 24.x (the version used for local development and CI)
- Install/build: `npm ci` / `npm run build` (configured in `vercel.json`)
- Output directory: Next.js default

## Database and environment

Use a dedicated hosted PostgreSQL database for this application. Do not connect preview deployments to production data. Apply all migrations to the intended database using `prisma migrate deploy`; migrations are deliberately not part of every preview build. Provision runtime roles with `scripts/db-roles.ts` only if the provider supports its role attributes. Validate that the application role enforces RLS and the system role can perform platform operations; do not replace both roles with an unrestricted database owner.

Set these private Vercel environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Hosted migration connection (direct connection for migration commands) |
| `APP_DATABASE_URL` | Restricted application role connection |
| `SYSTEM_DATABASE_URL` | System role connection for authentication and platform operations |
| `APP_URL` | Exact live HTTPS origin, e.g. `https://bluecoree-hrms.vercel.app` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Separate randomly generated secrets |
| `ENCRYPTION_KEY` | 32-byte hex encryption key; preserve the original when migrating encrypted local data |
| `SETUP_TOKEN` | Random secret for initial installation setup |
| `TRUST_PROXY` | `true` behind Vercel's proxy |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | Private S3-compatible object storage; configure before building for image CSP |

Add SMTP, payment, AI, face, push, and messaging provider variables only for integrations being enabled. Never put secrets in `NEXT_PUBLIC_*`, the repository, or `vercel.json`. `.vercelignore` excludes local credentials, database files, and uploads from CLI deployments.

For a fresh database, migrations install the catalogue; complete `/setup` to create the provider company and owner. The local owner account is not automatically copied into a new database. If retaining existing accounts, migrate the database deliberately and preserve encryption keys; do not publish demo credentials or seed demo users into production.

## Separate worker and uploads

Run `npm run worker` on a persistent worker host connected to the same database. Configure Redis when using multiple workers. Backups require PostgreSQL command-line tools, an encryption key, and persistent backup storage. Vercel deployment alone does not start this worker. Configure private S3-compatible uploads or a private Vercel Blob store before accepting employee documents or photos; local-disk uploads are refused on Vercel.

For Vercel Blob, connect a **private** store to production and configure `BLOB_READ_WRITE_TOKEN` (or the store's OIDC configuration). The app retains its expiring signed download links and fetches file content server-side; employee files never become public blobs. S3 takes precedence when both providers are configured. Server uploads remain subject to Vercel's request-size limits; large documents need a separate direct-upload implementation.

## Temporary cloud environment

The `bluecoree-billing/bluecoreehr` project uses a Neon Free database and private Blob storage in Singapore. Local `.env` remains connected to the original local database. Cloud credentials and operational files live in the ignored `.vercel/` directory, never Git. A verified encrypted snapshot was taken before migration. The local database is a point-in-time copy, not an automatically synchronized replica of future cloud changes.

The temporary site is `https://bluecoreehr.vercel.app`. Its database health, tenant login, attendance APIs, logout and private signed-file downloads were verified after deployment. The initial migrated counts were 9 companies, 86 employees and 89 users.

On the current workstation, `node .vercel/cloud-worker.cjs` runs the cloud worker using private settings and writes encrypted database backups to `data/cloud-backups`. It was started as a hidden process; it is not registered to restart automatically after a reboot. Do not run multiple copies without Redis. Worker logs are in `data/cloud-worker.log` and `data/cloud-worker-error.log`. Uploaded Blob objects require separate backup/export; database dumps do not contain those files.

For local backups of the cloud database, run the backup command with a private environment file containing the **direct** cloud owner connection, original encryption keys, a separate `BACKUP_DIR`, and `PGSSLMODE=require`. Do not restore cloud backups over the original local database without a deliberate restore procedure. A local worker/backup process only operates while the computer and its internet connection are running.

Hobby has usage and scheduling limits, and Vercel restricts it to personal, non-commercial use. Temporary deployment does not remove that restriction. SMTP, WhatsApp, face-provider and other external integrations still require their own configuration.

## Release verification

After setting environment variables, redeploy and check `/api/health`, `/owner/login`, first-password setup, owner dashboard, client subscription updates, public pricing, a tenant's login, and private upload/download. Configure integration webhook URLs for the live origin. Custom client domains need Vercel domain provisioning as well as the application's verification; the Docker/Caddy automatic certificate workflow is not deployed on Vercel.

References: [Vercel Node.js runtimes](https://vercel.com/docs/functions/runtimes), [Prisma 6 deployment guide](https://docs.prisma.io/docs/orm/v6/prisma-client/deployment/serverless/deploy-to-vercel), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).
