=== BlueCoreeHR ===
Contributors: bluecoreehr
Requires at least: 6.5
Requires PHP: 8.2
Stable tag: 0.1.0
License: GPL-2.0-or-later

Employee accounts and face attendance for PHP/WordPress hosting.

== Installation ==
Upload the ZIP in Plugins > Add New > Upload Plugin and activate on a staging single-site WordPress installation.
Open BlueCoreeHR in the WordPress administrator dashboard to check requirements, create a company and create employee accounts.
Activation creates an Employee portal page. Employees log in through WordPress and access only their own profile and attendance.
Use PHP 8.2+, OpenSSL, MySQL/InnoDB and HTTPS. Configure a real HTTPS face/liveness provider and encryption key in wp-config.php.
Exclude the employee portal and BlueCoree REST routes from all page/CDN caches. Configure working SMTP and WordPress login protection.

== Configuration ==
BLUECOREE_HR_FACE_URL: HTTPS provider base URL implementing /enroll and /verify.
BLUECOREE_HR_FACE_KEY: private provider Bearer key.
BLUECOREE_HR_ENCRYPTION_KEY: 64 hexadecimal characters generated securely, kept backed up and private.
Never use example credentials or unverified liveness responses for real attendance.

== Release scope ==
This is an employee/attendance first migration release. Existing HRMS accounts and historical records have not been imported.
Payroll, advanced HR workflows, subscription billing/expiry, GPS/geofences, overnight shifts and native mobile bearer APIs have not been ported.
Basic/Advanced feature entitlements are modeled; Advanced modules are not implemented in this package.
See wordpress/README.md in the repository for full scope, provider contract and local test instructions.
No production installation or physical-device AI test is implied by this package.

== Data ==
Face templates are encrypted. Camera photos are not saved in WordPress uploads.
Scan hashes, audit events, employee records and attendance are kept in plugin tables.
Deactivation/uninstallation does not delete HR data automatically.
