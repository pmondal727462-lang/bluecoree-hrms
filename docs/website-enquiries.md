# Website contact and demo enquiries

The public Contact page offers Request a demo and Talk to sales. Both save the visitor's name, email, phone, company, employee count and message before attempting notifications.

Recipients are **info@bluecoree.com** and **+91 7003904693**, configured in `src/config/sales.ts`. No customer-supplied value can change these recipients. Email includes the full enquiry and reference. WhatsApp includes the contact details, employee count, a 300-character message preview and reference; the full message is in the email/database.

## Activate delivery

1. Apply `npm run db:migrate` against the deployment database, then build.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` in the server environment. Use the mailbox provider's SMTP settings and an authorized sender. Never commit credentials.
3. Configure `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_LEAD_TEMPLATE`, `WHATSAPP_LEAD_TEMPLATE_LANGUAGE` and a supported `WHATSAPP_API_VERSION`. The phone-number ID identifies the sending WhatsApp Business number, not the recipient's phone number.
4. Have Meta approve a template with seven positional body variables, in this exact order: name, email, phone, company, employee count, message preview, enquiry reference. Suggested body: `New BlueCoreeHR enquiry. Name: {{1}}. Email: {{2}}. Phone: {{3}}. Company: {{4}}. Employees: {{5}}. Message preview: {{6}}. Reference: {{7}}. Full details are sent to your email.` Follow [Meta's template message format](https://www.postman.com/meta/whatsapp-business-platform/request/v6qk8j8/send-sample-shipping-confirmation-template).
5. Run `npm run worker` on a persistent host, or schedule `npm run job -- contact-leads` every five minutes. Vercel/serverless deployments need an external scheduler capable of running that command with the server environment; the request path makes the first attempt itself.

There are no SMTP or WhatsApp credentials configured in the local environment as of this change. Provider delivery has been tested with mocks, not with a live mailbox or phone.

## Delivery records

`contact_leads.notificationState` records each channel as PENDING, BLOCKED (missing configuration), SENT (provider accepted) or FAILED (ten unsuccessful attempts). Retries occur after ten minutes. Successful channels are skipped on subsequent attempts. Missing configuration does not consume retries. Leases prevent simultaneous workers from normally duplicating delivery. A crash after a provider accepts a message but before the database update can cause a duplicate on retry; transport acceptance does not prove inbox/device delivery.

Existing historical enquiries are not automatically forwarded. New enquiries remain saved even when either service is unavailable. To retry a FAILED record after fixing configuration, an operator can reset only that channel to PENDING with zero attempts and set `nextNotificationAt` to the current time; do not reset the successful channel.

The Contact page also exposes working email and WhatsApp links for direct conversations. The WhatsApp link itself does not automatically send form data.
