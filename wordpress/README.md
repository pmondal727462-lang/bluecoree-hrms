# BlueCoreeHR on Serverbyt Blaze

This folder contains an installable PHP/WordPress employee-attendance plugin. It uses WordPress accounts, MySQL/InnoDB tables, WordPress REST API and HTTPS calls to a face/liveness provider. It does not run Node.js, Composer, Docker, shell commands or an AI model on the hosting server. Docker is used only for local verification.

**This is the first migration release, not a full replacement for the existing Next.js HRMS. Do not switch the live HRMS domain to this package as if the migration were complete.**

## Implemented

- Activation creates company, employee, attendance, scan-hash and audit tables and an Employee portal page.
- WordPress administrator creates companies and employee accounts, with login emails visible in management. Password setup uses WordPress email; SMTP delivery must work.
- Employees sign in once through WordPress to view their own profile and attendance on desktop or mobile browsers.
- Company Basic/Advanced plans have separate feature lists. Suspending a company blocks employee API access on the server.
- Face enrollment requires explicit consent, successful liveness and provider confirmation. Templates use AES-256-GCM; photos are sent directly to the configured provider and are not written to WordPress uploads.
- Front camera starts on an explicit employee action, captures automatically after two seconds, and stops afterward. First successful scan each company-local calendar day checks in; later scans update checkout while preserving the original check-in. Repeated camera images and punches less than a minute apart are rejected. Five failed verifications lock scans for 15 minutes. Attempts are capped at 30 per employee per hour.
- Serialized scans, InnoDB transactions, tenant-scoped queries, WordPress REST cookie authentication/nonces, administrator capability checks, escaped displays and audit events protect the implemented workflows.

## Hosting prerequisites

Serverbyt advertises MySQL, SSL, WordPress installation and daily backups for Blaze. Its published WordPress documentation disables process-launching PHP functions; this plugin does not use those functions. The documentation's PHP-version list is old, so **verify the actual package runs PHP 8.2 or newer**, with OpenSSL and MySQL/InnoDB, before installation. Also verify custom plugin upload, outbound HTTPS requests and working WordPress email.

References:

- [Serverbyt Blaze features](https://www.serverbyt.com/)
- [Serverbyt PHP configuration](https://serverbyt.tawk.help/article/can-i-change-my-websites-php-configuration)
- [Disabled WordPress functions](https://serverbyt.tawk.help/article/which-php-functions-are-disabled-on-your-wordpress-platform)

## Build and install on staging

1. Get the destination domain and WordPress/StackCP access. Create a staging WordPress site and enable HTTPS. Confirm PHP 8.2+ and custom plugin permissions in the actual hosting account.
2. Run `powershell -ExecutionPolicy Bypass -File wordpress/build.ps1` locally. The ZIP is `wordpress/dist/bluecoree-hr.zip`.
3. In WordPress, use **Plugins → Add New → Upload Plugin**, upload the ZIP and activate it. This release requires a single-site WordPress installation.
4. Configure email delivery using the host's SMTP settings. In **BlueCoreeHR**, create a company and a test employee. The employee receives a password setup email.
5. Open the generated **Employee portal** page. Also usable via the `[bluecoree_hr]` shortcode on a different page.
6. Exclude the employee portal, login and `wp-json/bluecoree/*` routes from page/CDN caching. Do not cache authenticated responses. Install the host-recommended WordPress login protection and keep WordPress updated.
7. Configure the face provider and encryption key below. Test a real person, a different person and a photograph on a physical mobile device. No face attendance will be recorded while the provider is unconfigured or rejects liveness.

## Face provider configuration

Set these constants in `wp-config.php` before loading WordPress. Do not commit real keys to GitHub:

```php
define('BLUECOREE_HR_FACE_URL', 'https://your-face-service.example');
define('BLUECOREE_HR_FACE_KEY', 'your-private-service-key');
define('BLUECOREE_HR_ENCRYPTION_KEY', '64-hex-characters-from-a-secure-random-generator');
```

Back up the encryption key securely; losing it makes templates unreadable. The plugin never shows it in the admin dashboard.

The HTTPS provider must implement `POST /enroll` and `POST /verify`, accepting JSON `{requestId, sample, livenessRequired: true}` and, for verification, `template`. Both require Bearer authentication. Responses must echo `requestId`, report `status: SUCCESS`, `livenessPassed: true`, and confidence between 0.90 and 1. Enrollment also returns a nonempty `template`. If `faceCount` is returned, it must equal one. Provider contracts must guarantee one-person capture and real liveness verification. CompreFace's native API is not this contract; an adapter with a liveness implementation is required. No credentials or working production face service were available during this setup.

## Migration work still required

- Existing accounts, company IDs and records are not imported. The new plugin's WordPress accounts are separate until a tested identity/data migration is implemented. No existing data is deleted.
- PostgreSQL historical-data transfer and reconciliation, subscription expiry/billing/overrides, HR administration by company manager, policy configuration and face reset/retention are not implemented in this release.
- Overnight shifts, GPS/geofences, leave, payroll, statutory calculations, payslips, expenses, recruitment, training, performance, assets, work planning, notifications and full reports remain in the existing HRMS. Advanced entitlements are modeled; those advanced modules have not been ported here.
- The existing Expo app still uses the current `/api/v1` server. This plugin's API is `/wp-json/bluecoree/v1` and uses WordPress browser sessions, not the Expo bearer/refresh-token contract. A mobile-auth/API migration is needed before changing its server URL.
- Administrator lists show the latest 100 employees/attendance rows. Employee history shows the latest 62 work days. This release does not offer bulk imports or exports.
- The original HRMS password lockout/MFA/session policies have not been ported; this release relies on WordPress authentication. Face scan lockout is implemented separately.
- Live installation, host-specific checks and physical-device face testing need the destination URL, authorized access and a real provider. Do not treat local mocked-provider tests as proof of live AI matching.

## Local verification

```powershell
powershell -ExecutionPolicy Bypass -File wordpress/start-local.ps1
docker compose -f wordpress/compose.yaml exec -T wordpress php /opt/bluecoree-tests/integration.php
```

The local WordPress site listens only at `http://127.0.0.1:8090`. The fixtures refuse to run unless the database name and host match the isolated test compose environment. Provider responses are mocked only inside the test runner. Its generated database passwords live in ignored `wordpress/.env`. Test fixtures remove only records created by their own run.

Verification performed: all five plugin PHP files passed syntax checks on PHP 8.3; 38 isolated WordPress/MySQL checks passed; HTTP smoke checks confirmed anonymous GET/POST rejection, private cache headers and the generated employee login page. Portal JavaScript syntax passed. Real provider identity/liveness, destination-host compatibility and physical-device camera behavior remain unverified.

Deactivating/uninstalling this plugin does not automatically delete HR tables, accounts or history. Arrange explicit export and retention before any future deletion.
