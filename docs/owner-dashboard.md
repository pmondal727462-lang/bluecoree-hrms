# Software owner dashboard

Sign in at `/owner/login` using the software owner's email and password. This login accepts only platform Super Admin accounts and retains password lockout, authenticator/recovery codes, and session controls. Client company administrators cannot use this login or platform management APIs.

The dashboard is at `/admin`:

- **Clients & subscriptions:** create clients, assign plans, set subscription and trial dates, extend trials, suspend/reactivate companies, and reset client administrator access.
- **Access rights:** for each client, follow its plan/add-ons, allow an additional module, or block a module. These overrides do not change other clients' plans or bypass subscription expiry. Client employee permissions still depend on their assigned roles. Changes are audited.
- **Website pricing & plans:** manage monthly/annual and per-employee prices, minimum charges, limits, and modules. Only active public plans appear at `/pricing`; keep negotiated plans private with “Show on website pricing page: No.”
- **Billing:** manage add-ons, coupons, invoices, offline payments, and refunds through the existing billing controls.

Company deletion is available under **Management dashboard → Client list → Delete company** (also in Client subscriptions). Only platform Super Admins can delete a company. The dialog requires the exact company code and explains that deletion is permanent. The API rechecks protection inside a serializable transaction: the signed-in company, any company containing platform owner accounts, and companies under legal hold cannot be deleted.

`DELETE /api/platform/companies/:id` accepts `{ "companyCode": "EXACT_CODE" }`. It removes tenant records and sessions, preserves shared plans/permissions and other companies, and records `COMPANY_DELETED` in the operator's company audit log. Uploaded document versions, helpdesk attachments and employee photos are cleaned up after the database transaction commits. Pending storage cleanup is retained in that audit entry and retried every five minutes by the existing worker (`company-file-cleanup`); operators can also run `npm run job -- company-file-cleanup`. Run the scheduled worker for remaining files and temporary storage failures. Existing backups follow their normal retention policy. No schema migration is required for this option.

Deletion coverage: `tests/integration/company-deletion.test.ts` checks authorization, confirmation, protected companies, linked records, session revocation, tenant isolation, audit preservation and storage retries. `tests/unit/company-deletion-order.test.ts` detects schema changes that need additional cleanup or a different deletion order.

Owner provisioning is a local operator command, never public registration:

```powershell
node --import tsx scripts/create-owner.ts owner@example.com "Owner name"
```

It uses the existing provider company, refuses to overwrite an existing email, and saves a random temporary password to the ignored `data/owner-credentials.txt`. The owner must change that password on first sign-in. Do not run the demo seed to create an owner. Apply database migrations before deploying; the client-rights fields are in `20261001090000_client_rights`.

Validation: `tests/integration/owner.test.ts` covers owner/client login separation, owner-only rights changes, invalid/contradictory rights, module enforcement, default restoration, and audit records.
