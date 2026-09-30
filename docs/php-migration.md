# BlueCoreeHR PHP migration assessment

## Current application

The current website uses Next.js 16, React, TypeScript, Prisma and PostgreSQL. The Prisma schema contains 126 models. An Expo mobile app depends on the existing `/api/v1` endpoints and the shared authenticated API. No PHP application exists in this repository. PHP and Composer were not found on PATH during inspection.

## Proposed target

Update: the user selected Serverbyt Blaze with WordPress support. The WordPress-compatible first-release package is in `wordpress/`; see its README for implemented scope, installation and remaining migration work. The original Laravel proposal below is retained as an alternative architecture, not the selected implementation.

Use Laravel for the PHP web application and API. Select a supported Laravel/PHP version after checking the destination host. Preserve PostgreSQL initially to avoid combining an application rewrite with a database conversion. Use an isolated staging database and separate deployment until parity checks pass.

Hosting must support the selected PHP version, Composer, PostgreSQL connectivity, HTTPS, scheduled commands and background jobs. Laravel deployment guidance: https://laravel.com/framework/docs/deployment. The current Vercel deployment uses Node.js; PHP on Vercel uses a community runtime rather than its native Node.js setup: https://vercel.com/docs/functions/runtimes.

## Compatibility requirements

- Preserve company IDs, employee IDs, existing data and tenant boundaries. Port PostgreSQL row-level security context handling; a PHP connection must not accidentally bypass it or retain another tenant's context.
- Preserve existing bcrypt password hashes and test representative password verification before using live accounts. Translate account lockouts, password changes, MFA, recovery and session revocation.
- Preserve browser and mobile endpoint paths, JSON envelopes, errors, token claims, expiry and refresh rotation, or provide a documented mobile upgrade and session transition.
- Preserve subscription feature enforcement on both server routes and menus. Basic and Advanced must retain their distinct access.
- Translate encrypted-data formats explicitly. Existing encrypted face templates and bank details use application encryption; Laravel's default encryption format must not be assumed compatible. Test old ciphertext without printing secrets.
- Keep employee attendance, time zones, overnight shifts, first check-in/latest check-out, duplicate prevention, GPS/geofence policy, leave approvals and audit logs consistent.
- Keep external biometric device integration retired. Face matching and liveness remain dedicated server integrations; rewriting the website in PHP does not configure the currently missing production provider.
- Preserve files, private document authorization, payroll calculations, payslip exports, billing/webhook signatures, notifications and scheduled jobs.

## Implementation sequence

1. Confirm hosting and whether scope is the complete application or an employee/attendance first release. Install PHP/Composer and create a separate Laravel application.
2. Establish database compatibility, tenant isolation, authentication, roles and subscription enforcement. Verify these against isolated fixtures.
3. Port employee records, web dashboards and compatible mobile endpoints. Implement face enrollment and verified attendance through the configured provider.
4. Port remaining modules: leave, payroll, expenses, recruitment, onboarding, training, performance, assets, work planning, reports, integrations, support and platform management.
5. Compare the two applications against the same staging fixtures. Test calculations, access restrictions, concurrency, file authorization, encryption compatibility and mobile refresh behavior.
6. Prepare a database backup, staged PHP deployment, file transfer, scheduled jobs and a rollback procedure. Switch production routing only after verification.

## Outstanding decisions

- Destination hosting and available PHP/PostgreSQL/job support.
- Full feature migration versus employee/attendance first release.
- Deployment access, domain routing and approved migration window.

This document is an assessment, not a completed PHP port. No production changes or database migrations were performed as part of this assessment.
