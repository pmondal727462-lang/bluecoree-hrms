import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { systemDb as db } from "../../src/lib/db";
import { POST } from "../../src/app/api/[...path]/route";
import { testClientIp } from "./client";
import { call, Fixture } from "./helpers";

// Phase 15: feature service with add-ons, pricing, GST invoices, manual and
// Razorpay payments, webhooks, refunds, reminders, signup and marketing APIs.
const f = new Fixture();
let a = "";
const plan = `PRO_${f.prefix}`;
const coupon = `SAVE10${f.prefix}`;
const razorpay: { url: string; body: string }[] = [];
const secret = "rzp_test_secret";
const webhookSecret = "rzp_webhook_secret";

beforeAll(async () => {
  await db.subscriptionPlan.create({
    data: {
      code: plan,
      name: "Professional test",
      priceMonthly: 1000,
      priceAnnual: 10000,
      pricePerEmployeeMonthly: 50,
      pricePerEmployeeAnnual: 500,
      minimumMonthly: 3000,
      employeeLimit: 100,
      locationLimit: 2,
      storageLimitMb: 100,
      features: ["attendance", "payroll", "reports"],
      active: true,
      sortOrder: 999,
    },
  });
  await db.coupon.create({
    data: {
      code: coupon,
      percentOff: 10,
      maxRedemptions: 1,
      planCodes: [plan],
    },
  });
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("razorpay.com")) return real(input, init);
      razorpay.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/orders"))
        return Response.json({
          id: `order_${razorpay.length}`,
          amount: JSON.parse(String(init?.body)).amount,
          currency: "INR",
        });
      return Response.json({ id: "rfnd_1", status: "processed" });
    }),
  );
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("BILLING_SUPPLIER_STATE", "Karnataka");
  a = (await f.company("A")).id;
  await f.company("B");
  await f.user("admin", a, "Company Admin");
  await f.user("staff", a, "Employee");
  await f.user("root", f.companies[1], "Company Admin", { superAdmin: true });
  await f.user("other", f.companies[1], "Company Admin");
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const where = { companyId: { in: f.companies } };
  await db.refund.deleteMany({ where });
  await db.payment.deleteMany({ where });
  await db.invoice.deleteMany({ where });
  await db.subscriptionAddOn.deleteMany({ where });
  const signups = await db.signupRequest.findMany({
    where: {
      email: { endsWith: `@${f.prefix.toLowerCase()}.signup.example.com` },
    },
  });
  const created = signups.flatMap((s) => (s.companyId ? [s.companyId] : []));
  f.companies.push(...created);
  await db.signupRequest.deleteMany({
    where: { id: { in: signups.map((s) => s.id) } },
  });
  await db.contactLead.deleteMany({
    where: { email: `lead@${f.prefix.toLowerCase()}.example.com` },
  });
  await f.cleanup();
  await db.coupon.deleteMany({ where: { code: coupon } });
  await db.subscriptionPlan.deleteMany({ where: { code: plan } });
  await db.$disconnect();
});
const sign = (body: string, key: string) =>
  createHmac("sha256", key).update(body).digest("hex");

describe("Phase 15 billing", () => {
  it("quotes with the minimum charge, add-ons, coupon and GST", async () => {
    await call(f, "subscription/billing-profile", "PUT", "admin", {
      gstin: null,
      billingState: "Karnataka",
      billingEmail: null,
      address: "1 MG Road, Bengaluru",
    });
    expect(
      (
        await call(f, "subscription/billing-profile", "PUT", "admin", {
          gstin: "BAD",
          billingState: "Karnataka",
          billingEmail: null,
          address: null,
        })
      ).status,
    ).toBe(422);
    expect(
      (await call(f, "subscription/billing-profile", "PUT", "staff", {}))
        .status,
    ).toBe(403);
    // Two active employees: 1000 + 2 × 50 = 1100, raised to 3000; + AI add-on
    // 2 × 20 = 40; 10% off; CGST and SGST at 9% each (same state).
    const q = await call(f, "subscription/quote", "POST", "admin", {
      planCode: plan,
      cycle: "MONTHLY",
      addOns: [{ code: "AI_COPILOT" }],
      couponCode: coupon,
    });
    expect(q.body.data).toMatchObject({
      subtotal: 3040,
      discount: 304,
      cgst: 246.24,
      sgst: 246.24,
      igst: 0,
      total: 3228.48,
    });
    expect(
      (
        await call(f, "subscription/quote", "POST", "admin", {
          planCode: "FREE_TRIAL",
          cycle: "MONTHLY",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(f, "subscription/quote", "POST", "admin", {
          planCode: plan,
          cycle: "MONTHLY",
          couponCode: "NOPE",
        })
      ).body.errorCode,
    ).toBe("COUPON_INVALID");
  });

  it("issues a GST invoice, activates on manual payment and grants add-on features", async () => {
    const out = await call(f, "subscription/checkout", "POST", "admin", {
      planCode: plan,
      cycle: "MONTHLY",
      addOns: [{ code: "AI_COPILOT" }],
      couponCode: coupon,
    });
    expect(out.status).toBe(200);
    expect(out.body.data.payment.provider).toBe("MANUAL");
    const invoice = out.body.data.invoice;
    expect(invoice.number).toMatch(/^INV\/\d{4}-\d{2}\/\d{6}$/);
    expect(invoice).toMatchObject({ status: "ISSUED", total: 3228.48 });
    const pdf = await call(
      f,
      `subscription/invoices/${invoice.id}/pdf`,
      "GET",
      "admin",
    );
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(
      (await call(f, `subscription/invoices/${invoice.id}/pdf`, "GET", "other"))
        .status,
    ).toBe(404);
    // Only the Super Admin confirms offline payments.
    expect(
      (
        await call(
          f,
          `platform/invoices/${invoice.id}/mark-paid`,
          "POST",
          "other",
          {
            reference: "UTR123",
          },
        )
      ).status,
    ).toBe(403);
    const paid = await call(
      f,
      `platform/invoices/${invoice.id}/mark-paid`,
      "POST",
      "root",
      {
        reference: "UTR123456",
      },
    );
    expect(paid.body.data.status).toBe("PAID");
    const sub = (await call(f, "subscription", "GET", "admin")).body.data
      .current;
    expect(sub).toMatchObject({ status: "ACTIVE", billingCycle: "MONTHLY" });
    expect(sub.plan.features).toContain("ai");
    expect(sub.addOns.map((x: { code: string }) => x.code)).toEqual([
      "AI_COPILOT",
    ]);
    expect(
      (await db.coupon.findUniqueOrThrow({ where: { code: coupon } }))
        .redemptions,
    ).toBe(1);
    // The coupon is used up; recruitment is not in the plan or add-ons.
    expect(
      (
        await call(f, "subscription/quote", "POST", "admin", {
          planCode: plan,
          cycle: "MONTHLY",
          couponCode: coupon,
        })
      ).body.errorCode,
    ).toBe("COUPON_INVALID");
    expect(
      (await call(f, "recruitment/jobs", "GET", "admin")).body.errorCode,
    ).toBe("FEATURE_NOT_IN_PLAN");
    // The plan's location limit is enforced (the head office is one).
    expect(
      (
        await call(f, "branches", "POST", "admin", {
          name: "Pune",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(f, "branches", "POST", "admin", {
          name: "Delhi",
        })
      ).body.errorCode,
    ).toBe("PLAN_LIMIT_REACHED");
  });

  it("takes Razorpay payments with verified signatures, webhooks and refunds", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", secret);
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
    const out = await call(f, "subscription/checkout", "POST", "admin", {
      planCode: plan,
      cycle: "ANNUAL",
    });
    const { orderId, keyId, amountPaise } = out.body.data.payment;
    expect(keyId).toBe("rzp_test_key");
    // 10000 + 2 × 500 = 11000, raised to the 36000 annual minimum, + 18%.
    expect(amountPaise).toBe(4248000);
    expect(
      (
        await call(f, "subscription/verify", "POST", "admin", {
          orderId,
          paymentId: "pay_1",
          signature: "forged",
        })
      ).body.errorCode,
    ).toBe("PAYMENT_SIGNATURE_INVALID");
    const before = (
      await db.subscription.findUniqueOrThrow({ where: { companyId: a } })
    ).currentPeriodEnd!;
    const verified = await call(f, "subscription/verify", "POST", "admin", {
      orderId,
      paymentId: "pay_1",
      signature: sign(`${orderId}|pay_1`, secret),
    });
    expect(verified.body.data.status).toBe("PAID");
    const after = await db.subscription.findUniqueOrThrow({
      where: { companyId: a },
    });
    // Paid early, so the annual period starts when the monthly one ends.
    expect(after.billingCycle).toBe("ANNUAL");
    expect(after.currentPeriodStart!.getTime()).toBe(before.getTime());
    // The webhook for the same payment changes nothing (idempotent).
    const event = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_1", order_id: orderId, method: "upi" } },
      },
    });
    const hook = (body: string, signature: string) =>
      POST(
        new NextRequest("http://localhost:3000/api/billing/razorpay/webhook", {
          method: "POST",
          headers: {
            "x-forwarded-for": testClientIp,
            "content-type": "application/json",
            "x-razorpay-signature": signature,
          },
          body,
        }),
        {
          params: Promise.resolve({ path: ["billing", "razorpay", "webhook"] }),
        },
      );
    expect((await hook(event, "bad")).status).toBe(401);
    const res = await hook(event, sign(event, webhookSecret));
    expect((await res.json()).data).toEqual({ captured: false });
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { companyId: a } }))
        .currentPeriodEnd,
    ).toEqual(after.currentPeriodEnd);
    // Partial refund through the provider.
    const inv = await db.invoice.findFirstOrThrow({
      where: { companyId: a, billingCycle: "ANNUAL" },
    });
    expect(
      (
        await call(f, `platform/invoices/${inv.id}/refund`, "POST", "root", {
          amount: 99999,
          reason: "Too much",
        })
      ).status,
    ).toBe(422);
    const refund = await call(
      f,
      `platform/invoices/${inv.id}/refund`,
      "POST",
      "root",
      {
        amount: 1000,
        reason: "Goodwill credit",
      },
    );
    expect(refund.body.data).toMatchObject({
      status: "PROCESSED",
      amount: 1000,
    });
    expect(razorpay.at(-1)!.url).toContain("/payments/pay_1/refund");
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status,
    ).toBe("PARTIALLY_REFUNDED");
    const history = (await call(f, "subscription/invoices", "GET", "admin"))
      .body.data;
    expect(history).toHaveLength(2);
    expect(
      (await call(f, "subscription/invoices", "GET", "other")).body.data,
    ).toHaveLength(0);
  });

  it("sends trial and renewal reminders once", async () => {
    await db.subscription.update({
      where: { companyId: a },
      data: { currentPeriodEnd: new Date(Date.now() + 3 * 86400000) },
    });
    const first = (
      await call(f, "platform/jobs/billing-reminders", "POST", "root")
    ).body.data;
    expect(first.renewalReminders).toBeGreaterThanOrEqual(1);
    const again = (
      await call(f, "platform/jobs/billing-reminders", "POST", "root")
    ).body.data;
    expect(again.renewalReminders).toBe(0);
  });
});

describe("Phase 15 signup and marketing", () => {
  it("creates a trial company only after email verification", async () => {
    const email = `owner@${f.prefix.toLowerCase()}.signup.example.com`;
    const body = {
      companyName: "Nimbus Retail",
      adminName: "Meera Iyer",
      email,
      password: "A-long-signup-password-1",
      acceptTerms: true,
    };
    expect(
      (
        await call(f, "public/signup", "POST", "", {
          ...body,
          password: "short",
        })
      ).status,
    ).toBe(422);
    const sent = await call(f, "public/signup", "POST", "", body);
    expect(sent.body.data.sent).toBe(true);
    const token = sent.body.data.devLink.split("/verify/")[1];
    expect(
      await db.company.count({
        where: { name: "Nimbus Retail", code: { startsWith: "NIMBUSRE" } },
      }),
    ).toBe(0);
    const verified = await call(f, "public/signup/verify", "POST", "", {
      token,
    });
    expect(verified.status).toBe(200);
    const code = verified.body.data.companyCode;
    expect(code).toMatch(/^NIMBUSRE\d{4}$/);
    expect(verified.headers.getSetCookie().join(";")).toContain("hrms_access");
    const company = await db.company.findUniqueOrThrow({
      where: { code },
      include: { subscription: { include: { plan: true } } },
    });
    expect(company.subscription?.status).toBe("TRIAL");
    const owner = await db.user.findFirstOrThrow({
      where: { companyId: company.id },
      include: { role: true },
    });
    expect(owner.role.name).toBe("Company Owner");
    expect(
      (await call(f, "public/signup/verify", "POST", "", { token })).status,
    ).toBe(410);
    // The new owner can sign in and sees the setup checklist.
    await f.login("nimbus", company.id, email, body.password);
    const setup = (await call(f, "setup-progress", "GET", "nimbus")).body.data;
    expect(setup.steps.map((s: { key: string }) => s.key)).toContain(
      "employees",
    );
    expect(setup.completed).toBeGreaterThanOrEqual(1);
  });

  it("serves public pricing and stores contact enquiries", async () => {
    const pricing = (await call(f, "public/plans", "GET", "")).body.data;
    expect(pricing.plans.map((p: { code: string }) => p.code)).toContain(plan);
    expect(JSON.stringify(pricing)).not.toContain("apiCallLimitMonthly");
    const lead = await call(f, "public/contact", "POST", "", {
      name: "Rahul",
      email: `lead@${f.prefix.toLowerCase()}.example.com`,
      message: "Please call me about pricing for 200 staff.",
      employees: 200,
    });
    expect(lead.body.data.received).toBe(true);
    expect(
      await db.contactLead.count({
        where: { email: `lead@${f.prefix.toLowerCase()}.example.com` },
      }),
    ).toBe(1);
  });
});
