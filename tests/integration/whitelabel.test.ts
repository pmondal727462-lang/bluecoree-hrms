import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemDb as db, withSystem, withTenant } from "../../src/lib/db";
import { call, Fixture } from "./helpers";

// Phase 16: white-label email branding and custom-domain routing.
const mail: { from: unknown; subject: string; text: string }[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { from: unknown; subject: string; text: string }) => {
        mail.push(m);
      },
    }),
  },
}));

const f = new Fixture();
let a = "";
let b = "";
const domain = `hr-${f.prefix.toLowerCase()}.example.com`;
const origin = `https://${domain}`;

beforeAll(async () => {
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_USER", "mailer");
  vi.stubEnv("SMTP_PASSWORD", "secret");
  vi.stubEnv("SMTP_FROM", "HRMS <no-reply@example.com>");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  a = (await f.company("A")).id;
  b = (await f.company("B")).id;
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("other", b, "Company Admin");
  const addOn = await db.addOn.findUniqueOrThrow({
    where: { code: "WHITE_LABEL" },
  });
  await db.subscriptionAddOn.create({
    data: { companyId: a, addOnId: addOn.id },
  });
  await db.companyBranding.create({
    data: {
      companyId: a,
      brandName: "Acme People",
      emailFooter: "Acme Corp · HR team",
      customDomain: domain,
      domainToken: "hrms-verify-test",
      domainVerifiedAt: new Date(),
    },
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const where = { companyId: { in: f.companies } };
  await db.subscriptionAddOn.deleteMany({ where });
  await db.companyBranding.deleteMany({ where });
  await db.notification.deleteMany({ where });
  await f.cleanup();
  await db.$disconnect();
});

describe("Phase 16 white label", () => {
  it("uses the company's verified domain for links", async () => {
    const { companyAppUrl } = await import("../../src/modules/saas/branding");
    expect(await withSystem(() => companyAppUrl(a))).toBe(`http://${domain}`);
    expect(await withSystem(() => companyAppUrl(b))).toBe(
      "http://localhost:3000",
    );
    const careers = await call(f, "recruitment/careers", "GET", "admin");
    expect(careers.body.data.url).toBe(
      `http://${domain}/careers/${f.codes[0]}`,
    );
  });

  it("accepts requests from the verified domain and binds sign-in to its company", async () => {
    const cookieless = (
      path: string,
      headers: Record<string, string>,
      body: unknown,
    ) => call(f, path, "POST", "", body, headers);
    const creds = {
      identifier: `admin@${f.prefix.toLowerCase()}.example.com`,
      password: "Integration-Password-123!",
    };
    // Unknown origins are still refused.
    expect(
      (
        await cookieless(
          "auth/login",
          { origin: "https://evil.example.net" },
          {
            ...creds,
            companyCode: f.codes[0],
          },
        )
      ).body.errorCode,
    ).toBe("CSRF_REJECTED");
    // The company's own domain signs in its own users only.
    const wrong = await cookieless(
      "auth/login",
      { origin, host: domain },
      { ...creds, companyCode: f.codes[1] },
    );
    expect(wrong.body.errorCode).toBe("WRONG_COMPANY_DOMAIN");
    const right = await cookieless(
      "auth/login",
      { origin, host: domain },
      { ...creds, companyCode: f.codes[0] },
    );
    expect(right.status).toBe(200);
    const branding = await call(f, `public/branding?host=${domain}`, "GET", "");
    expect(branding.body.data).toMatchObject({
      companyCode: f.codes[0],
      brandName: "Acme People",
    });
  });

  it("issues TLS only for verified white-label domains", async () => {
    expect(
      (await call(f, `public/domain-check?domain=${domain}`, "GET", "")).status,
    ).toBe(200);
    expect(
      (
        await call(
          f,
          "public/domain-check?domain=unknown.example.org",
          "GET",
          "",
        )
      ).status,
    ).toBe(404);
    // Without the white-label entitlement the domain stops working.
    await db.subscriptionAddOn.updateMany({
      where: { companyId: a },
      data: { cancelledAt: new Date() },
    });
    const plan = await db.subscription.findUniqueOrThrow({
      where: { companyId: a },
      include: { plan: true },
    });
    const planHasIt = plan.plan.features.includes("whitelabel");
    expect(
      (await call(f, `public/domain-check?domain=${domain}`, "GET", "")).status,
    ).toBe(planHasIt ? 200 : 404);
    await db.subscriptionAddOn.updateMany({
      where: { companyId: a },
      data: { cancelledAt: null },
    });
  });

  it("brands notification email with the company name and footer", async () => {
    const { notify } = await import("../../src/modules/notifications/service");
    mail.length = 0;
    await withTenant(a, () =>
      notify(a, [f.users.staff], "leave.approved", {
        leaveType: "Casual",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
      }),
    );
    expect(mail).toHaveLength(1);
    expect(mail[0].from).toEqual({
      name: "Acme People",
      address: "no-reply@example.com",
    });
    expect(mail[0].text).toContain("Acme Corp · HR team");
    // Another company's email is unbranded.
    mail.length = 0;
    await withTenant(b, () =>
      notify(b, [f.users.other], "leave.approved", {
        leaveType: "Casual",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
      }),
    );
    expect(mail[0].from).toBe("HRMS <no-reply@example.com>");
  });
});
