# Management portal and pricing

Open `/owner/login` and sign in with the existing software-owner account. The portal has four sections:

- **Client list:** client details, Client access (follow plan / allow / block modules), Enable client or Suspend client, and Reset login. Suspension signs the company's users out without deleting their records. Reset login generates a one-time link for the administrator; Management shares it through a verified channel.
- **Client subscriptions:** assign a plan, set subscription status and expiry, and review active employee counts and annual estimates.
- **Add client:** create the company and its administrator login.
- **Pricing:** edit annual base fees, employee rates, plan access, and the Live Tracking add-on.

Management can explicitly grant Live Tracking through Client access, or let access follow the purchased add-on. Client administrators cannot change platform access rights. Changes are audited. Client access overrides do not bypass an expired subscription.

In **Client subscriptions → Subscription**, set **Employee licence limit** to the purchased capacity (for example, 50). Client rows show active employees / effective limit. Creating, importing, hiring or reactivating employees cannot exceed that limit, including simultaneous requests. Inactive employees release capacity. Blank follows the plan limit; a plan's lower cap still applies. Management must first deactivate excess employees before reducing capacity below current usage. This controls capacity; the existing annual estimate continues to use active employee counts.

Client navigation, home shortcuts and setup links show only modules in effective subscription access, including purchased add-ons and Management overrides. Essential account and company administration pages remain available. API checks also prevent direct access to unpurchased modules.

## Current public catalogue

| Offering | Annual company base fee | Per employee / year |
| --- | ---: | ---: |
| Basic | ₹30,000 | ₹100 |
| Advanced | ₹30,000 | ₹150 |
| Live Tracking add-on | No additional base fee | ₹150 |

Annual billing only; taxes are additional. A company pays one base fee for its chosen plan. For 50 active employees, Basic is ₹35,000/year, Advanced is ₹37,500/year and Live Tracking adds ₹7,500/year. Checkout uses the company's active employee count (minimum one). Website estimates use the entered team size. Historical invoices retain their saved amounts when the owner changes prices.

Advanced displays “Everything in Basic +” and the owner-provided feature list. Job timers, scheduling, activity progress, agency contracts, actual break capture and the multi-site dashboard are implemented; see [workforce.md](workforce.md). Automatic face scanning runs while the attendance page is open. Face recognition and spoof detection require a configured face/liveness provider. Offline attendance preparation and limitations are described in [offline-attendance.md](offline-attendance.md).

Enterprise and older add-ons are hidden from new public purchases; existing subscriptions retain their access. Existing database plan code `PROFESSIONAL` is displayed as **Advanced** to preserve subscription references.

Apply migrations with `npm run db:migrate` before deploying the updated application. Generate Prisma Client and rebuild. The local database has been migrated; a separate hosted database needs the same deployment step.
