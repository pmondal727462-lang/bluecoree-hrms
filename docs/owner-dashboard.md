# Software owner dashboard

Sign in at `/owner/login` using the software owner's email and password. This login accepts only platform Super Admin accounts and retains password lockout, authenticator/recovery codes, and session controls. Client company administrators cannot use this login or platform management APIs.

The dashboard is at `/admin`:

- **Clients & subscriptions:** create clients, assign plans, set subscription and trial dates, extend trials, suspend/reactivate companies, and reset client administrator access.
- **Access rights:** for each client, follow its plan/add-ons, allow an additional module, or block a module. These overrides do not change other clients' plans or bypass subscription expiry. Client employee permissions still depend on their assigned roles. Changes are audited.
- **Website pricing & plans:** manage monthly/annual and per-employee prices, minimum charges, limits, and modules. Only active public plans appear at `/pricing`; keep negotiated plans private with “Show on website pricing page: No.”
- **Billing:** manage add-ons, coupons, invoices, offline payments, and refunds through the existing billing controls.

Owner provisioning is a local operator command, never public registration:

```powershell
node --import tsx scripts/create-owner.ts owner@example.com "Owner name"
```

It uses the existing provider company, refuses to overwrite an existing email, and saves a random temporary password to the ignored `data/owner-credentials.txt`. The owner must change that password on first sign-in. Do not run the demo seed to create an owner. Apply database migrations before deploying; the client-rights fields are in `20261001090000_client_rights`.

Validation: `tests/integration/owner.test.ts` covers owner/client login separation, owner-only rights changes, invalid/contradictory rights, module enforcement, default restoration, and audit records.
