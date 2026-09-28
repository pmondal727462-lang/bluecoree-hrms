# Offline employee attendance

Sign in online on the employee's own device, then open **Offline clock-in** in the employee portal. Bookmark `/offline/index.html`. Open it once before travelling to a site with poor connectivity. Use the same browser and device for clock-ins and clock-outs.

The clock saves punches in IndexedDB before attempting a network request. Closing and reopening the page preserves pending punches. It retries automatically when connectivity returns, every 30 seconds while visible, and when the employee portal reopens. The page or portal must be open for automatic sync; this is not background syncing while the browser is closed. **Sync now** retries manually. An expired session requires signing in again as the same employee.

The offline permit lasts seven days after online preparation. Recorded punches can sync for 30 days after capture. Up to 200 pending punches are retained per employee on a device. Do not clear browser site data before syncing. Browsers can evict site storage; use normal browsing mode with sufficient storage. HTTPS is required outside localhost.

## Verification and privacy

“Saved on device” means pending, not approved attendance. Original capture timestamps are preserved. The server applies current permissions, subscription access, GPS/geofence checks, face verification, shift rules, leave conflicts and payroll locks during sync. Rejected punches remain on the device with the error for HR review; later punches wait to preserve order. Each event has a stable ID so retrying a successful request cannot duplicate attendance.

Offline times and locations are device-reported evidence, not tamper-proof timestamps. HR can identify the Offline source and review capture and server receipt times in the audit log. A signed device permit limits accepted timestamps and binds punches to one employee and company. Offline operation cannot detect policy changes until reconnection.

Required face photos and location payloads are encrypted on the device with a non-extractable AES-GCM key and removed after successful acknowledgement. Encryption does not replace a device screen lock. The service worker caches only the public offline HTML, JavaScript and CSS, never authenticated pages or API responses. Another employee's session cannot sync a saved punch.

## Deployment

Run `prisma migrate deploy`, generate Prisma Client and rebuild. Serve `/offline/` on the same HTTPS origin as the portal. Increment the service worker cache version whenever the public offline assets change. Test by preparing online, disconnecting the test device, saving IN/OUT, reopening the cached page, and reconnecting. Confirm pending counts clear and reports show the original capture times.
