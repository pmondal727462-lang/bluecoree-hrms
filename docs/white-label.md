# Phase 16 — White label

Checked on 27 September 2026 against the [master specification](master-specification.md) §54 ("logo, company name, colors, login page, email branding, payslip branding, employee portal branding, custom-domain architecture").

| Requirement | Status |
| --- | --- |
| Logo, company name, colours | Implemented: brand name, portal title, primary and secondary colours, and a PNG or JPEG logo (checked by content signature; SVG refused). Company → Subscription → Branding. |
| Login page | Implemented: the login page loads branding by `?company=CODE` or by the host it is served on, and fills in the company code. **Added:** on a verified custom domain, only that company's users can sign in (`WRONG_COMPANY_DOMAIN`), so one tenant's domain cannot be used for another tenant's logins. |
| Email branding | **Fixed:** the sender supported a brand, but notification emails never passed it. Notification emails now show the company's brand as the sender name (on the platform's configured address, so SPF and DKIM are unchanged) and append the company's email footer. Links in them use the company's domain. Companies without white label send unbranded mail. |
| Payslip branding | Implemented: logo, brand colour, brand name and footer on the server-generated payslip PDF. **Changed:** these apply only while the company has white label (plan or add-on). |
| Employee portal branding | Implemented: the workspace uses the company's brand, colours and logo when white label is active |
| Custom-domain architecture | Domain ownership is verified with a DNS TXT record (`_hrms-verify.<domain>`). **Added:** <br>• **Links:** onboarding portal, offer, careers page and notification links use `https://<verified domain>`. <br>• **Origin check:** requests from a verified domain pass the same-origin check. <br>• **TLS:** `GET /api/public/domain-check?domain=` confirms a verified white-label domain for an on-demand TLS proxy (Caddy `ask`); see the Phase 18 deployment guide. <br>• **Entitlement:** a domain stops working when the company loses the white-label entitlement. |

**Verification:** `tests/integration/whitelabel.test.ts` has 4 tests. They cover:
- the company link base and careers URL on its domain, and the platform URL for others;
- origin acceptance for the verified domain and refusal for unknown origins;
- sign-in bound to the domain's company;
- branding looked up by host;
- the TLS domain check, including loss of the entitlement;
- branded sender and footer for a white-label company, and unbranded mail for another.

**Not verified here:** real DNS and TLS issuance for a customer domain, because that needs a public server and DNS control.
