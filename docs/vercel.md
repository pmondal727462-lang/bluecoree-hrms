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

Run `npm run worker` on a persistent worker host connected to the same database. Configure Redis when using multiple workers. Backups require PostgreSQL command-line tools, an encryption key, and persistent backup storage. Vercel deployment alone does not start this worker. Configure private S3-compatible uploads before accepting employee documents or photos; the local storage fallback cannot persist on Vercel.

## Release verification

After setting environment variables, redeploy and check `/api/health`, `/owner/login`, first-password setup, owner dashboard, client subscription updates, public pricing, a tenant's login, and private upload/download. Configure integration webhook URLs for the live origin. Custom client domains need Vercel domain provisioning as well as the application's verification; the Docker/Caddy automatic certificate workflow is not deployed on Vercel.

References: [Vercel Node.js runtimes](https://vercel.com/docs/functions/runtimes), [Prisma 6 deployment guide](https://docs.prisma.io/docs/orm/v6/prisma-client/deployment/serverless/deploy-to-vercel), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).
