# Phase 15 — SaaS subscriptions, billing, signup and marketing site

Checked on 27 September 2026 against the [master specification](master-specification.md) §46–50, §72–76.

| Requirement | Status |
| --- | --- |
| Plans (trial, basic, professional, enterprise), monthly and annual, configurable without code | **Extended:** the Super Admin sets a flat monthly and annual price, a per-employee price (monthly and annual), a minimum monthly charge, the GST rate, and limits for employees, admins, storage, API calls, AI requests, devices and **locations (new)**. Plans can be hidden from the public. |
| Employee-based pricing, minimum charge, feature-based pricing, add-ons | **Added:** price = flat price + per-employee price × active employees. It is never below the minimum monthly charge (× 12 for annual), then add-ons are added. Add-ons can be priced flat or per employee. The seeded add-ons are biometric, AI Copilot, advanced payroll, recruitment, white label, API and extra storage. Add-ons are bought without changing the base plan. |
| Centralized feature service | **Added** `entitlements()` and `canUse()` in `saas/service.ts`: plan features plus active add-ons, with add-on storage, AI and API allowances. Every module gate uses it; the face and white-label checks were changed from direct plan reads. A company without a subscription is refused (402), except the provider's own company for branding. |
| Limits enforced | Employees, admins, storage, API calls, AI requests and devices as before. **Added:** work locations, and add-on allowances. |
| Trial (configurable; track start, end, status; restrict after expiry; never delete data) | Implemented. **Added:** reminders 3 days before the trial ends and 7 days before renewal, each sent once (`platform/jobs/billing-reminders`; the scheduled worker comes in Phase 18). |
| Billing: invoice, payment history, invoice number, GST, payment and refund status; payment-provider architecture; no card data | **Added:** GST tax invoices. They are numbered sequentially per financial year (`INV/2026-27/000001`) and split CGST and SGST for the same state, IGST otherwise, based on the company's billing state and the supplier state. Invoices show GSTIN, place of supply and SAC, and download as PDF. Payments go through **Razorpay**: an order is created, the checkout signature is verified, and a signature-checked webhook (`/api/billing/razorpay/webhook`) confirms capture. Capture is idempotent under concurrent callback and webhook, so a period is never extended twice. **Offline payments** are confirmed by the Super Admin. **Refunds** can be full or partial, through the provider when the payment was online, and the invoice's refund status updates. Coupons (percent or amount, plan-restricted, dated, usage-limited) and fully discounted purchases are supported. No card data reaches the server. |
| Payment activation | Payment activates the plan, cycle and add-ons, and redeems the coupon. Paying early extends from the end of the current period. |
| Super Admin pricing control | Platform → Billing: add-ons, coupons, all invoices with PDF, mark paid, refund, and send reminders. Platform → Plans has the new price fields. |
| Public signup → verify email → company setup | **Added:** `/start-trial`. The signup is rate-limited and has a honeypot; the password is hashed straight away, and a verification link valid for 24 hours is emailed. Development returns the link when SMTP is not configured. Opening the link creates the company on the free trial with a unique company code, creates the owner user and employee record, and signs the owner in. A second use is refused. The owner then sees a **setup checklist** on the home page, derived from real data (company and billing details, organisation, employees, leave, holidays, shifts, payroll), which can be dismissed. |
| Marketing website | **Added:** the pages are home (`/`, which previously redirected to the dashboard), features (HR, attendance, payroll, recruitment, performance, AI and mobile sections), pricing, resources, contact, start free trial and API reference. Pricing comes live from the plan catalogue, with an employee-count estimate and add-ons. The FAQ is on the resources page. Contact enquiries are stored and optionally emailed to `SALES_EMAIL`. |

**Fixes found in testing:**
- The same-origin (CSRF) check rejected server-to-server calls without an Origin header. That included the payment webhook and public API writes using `X-API-Key`. Both authenticate themselves and are now exempt; cookie sessions are still checked.
- The company settings screen would have sent the new billing fields back to the strict company update; they are now excluded from that screen.

**Verification:**
- `tests/unit/pricing.test.ts` has 4 tests covering the minimum charge, per-employee annual pricing, add-ons, coupon, IGST, the coupon cap, the employee limit, periods and financial years.
- `tests/integration/billing.test.ts` has 6 tests. They cover:
  - billing profile validation and permissions;
  - the quote against hand-calculated numbers;
  - invalid coupon and plan;
  - invoice numbering, PDF and cross-tenant access;
  - Super-Admin-only offline payment;
  - activation with add-on features, coupon redemption and use-up;
  - a module outside the plan refused, and the location limit;
  - Razorpay checkout amount, forged-signature refusal, early renewal extending the period, the idempotent webhook with signature check, and a provider refund with partial-refund status;
  - invoice history isolation and reminders sent once;
  - signup validation, verification creating a trial company, owner and session, a replayed link refused, and the setup checklist;
  - public pricing without internal limits, and contact enquiries.
- `tests/integration/integrations.test.ts` now also checks an API-key write without an Origin header.

**Not verified here:**
- A live Razorpay account. Tests stub the provider and use real HMAC signatures.
- Real email delivery of verification links.
- Refund timing on the provider side.
