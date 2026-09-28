import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { db, withSystem, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { pdfText } from "@/lib/export";
import { product } from "@/config/product";
import {
  createOrder,
  razorpayConfigured,
  refundPayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/integrations/razorpay";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import {
  financialYearLabel,
  periodFrom,
  quote,
  type Cycle,
  type Line,
} from "./pricing";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;
const day = 86400000;
const code = z.string().trim().min(1).max(40);
const purchaseSchema = z
  .object({
    planCode: code,
    cycle: z.enum(["MONTHLY", "ANNUAL"]),
    addOns: z
      .array(
        z
          .object({
            code,
            quantity: z.number().int().min(1).max(100).default(1),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    couponCode: code.optional(),
  })
  .strict();
type Purchase = z.infer<typeof purchaseSchema>;
const profileSchema = z
  .object({
    gstin: z
      .string()
      .trim()
      .regex(
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
        "Enter a valid GSTIN.",
      )
      .nullable(),
    billingState: z.string().trim().min(2).max(60),
    billingEmail: z.email().max(200).nullable(),
    address: z.string().trim().max(500).nullable(),
  })
  .strict();

// The provider's own details printed on tax invoices.
export const supplier = () => ({
  name: process.env.BILLING_SUPPLIER_NAME || product.name,
  gstin: process.env.BILLING_SUPPLIER_GSTIN || null,
  state: process.env.BILLING_SUPPLIER_STATE || "Karnataka",
  address: process.env.BILLING_SUPPLIER_ADDRESS || null,
});
const num = (v: Prisma.Decimal | number | null) =>
  v === null ? null : Number(v);

async function resolve(client: Client, companyId: string, p: Purchase) {
  const [plan, company, employees] = await Promise.all([
    client.subscriptionPlan.findUnique({ where: { code: p.planCode } }),
    client.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, gstin: true, address: true, billingState: true },
    }),
    client.employee.count({
      where: { companyId, status: { not: "Inactive" } },
    }),
  ]);
  if (!plan || !plan.active || !plan.public || plan.code === "FREE_TRIAL")
    throw new AppError(404, "Choose an available paid plan.", "NOT_FOUND");
  const codes = p.addOns.map((a) => a.code);
  const addOns = await client.addOn.findMany({
    where: { code: { in: codes }, active: true, public: true },
  });
  if (addOns.length !== new Set(codes).size)
    throw new AppError(
      404,
      "One of the add-ons is not available.",
      "NOT_FOUND",
    );
  let coupon = null;
  if (p.couponCode) {
    const c = await client.coupon.findUnique({
      where: { code: p.couponCode.toUpperCase() },
    });
    const now = new Date();
    if (
      !c ||
      !c.active ||
      (c.validFrom && c.validFrom > now) ||
      (c.validUntil && c.validUntil < now) ||
      (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) ||
      (c.planCodes.length && !c.planCodes.includes(plan.code))
    )
      throw new AppError(
        422,
        "This coupon is not valid for this purchase.",
        "COUPON_INVALID",
      );
    coupon = c;
  }
  let q;
  try {
    q = quote({
      plan,
      cycle: p.cycle,
      employees: Math.max(1, employees),
      addOns: addOns.map((a) => ({
        ...a,
        quantity: p.addOns.find((x) => x.code === a.code)!.quantity,
      })),
      coupon,
      sameState:
        !!company.billingState &&
        company.billingState.toLowerCase() === supplier().state.toLowerCase(),
    });
  } catch (e) {
    throw new AppError(422, (e as Error).message, "PLAN_LIMIT_REACHED");
  }
  return { plan, company, coupon, quote: q };
}

async function nextNumber(tx: Tx, at: Date) {
  const fy = financialYearLabel(at);
  const [row] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "invoice_counters" ("financialYear", "last") VALUES (${fy}, 1)
    ON CONFLICT ("financialYear") DO UPDATE SET "last" = "invoice_counters"."last" + 1
    RETURNING "last"`;
  return `INV/${fy}/${String(row.last).padStart(6, "0")}`;
}

// Payment received: the invoice is paid and the subscription, add-ons and
// coupon take effect. Safe to call more than once for the same payment.
async function capture(
  tx: Tx,
  payment: { id: string; status: string; invoiceId: string; companyId: string },
  details: { providerPaymentId?: string; method?: string; reference?: string },
) {
  // The status guard lets only one of a racing callback and webhook win.
  const won = await tx.payment.updateMany({
    where: { id: payment.id, status: { not: "CAPTURED" } },
    data: { status: "CAPTURED", capturedAt: new Date(), ...details },
  });
  if (!won.count) return false;
  const invoice = await tx.invoice.update({
    where: { id: payment.invoiceId },
    data: { status: "PAID", paidAt: new Date() },
  });
  await activate(tx, invoice);
  return true;
}
async function activate(
  tx: Tx,
  invoice: {
    companyId: string;
    planCode: string;
    billingCycle: string;
    lines: Prisma.JsonValue;
    couponCode: string | null;
  },
) {
  const purchase = (invoice.lines as { purchase: Purchase }).purchase;
  const plan = await tx.subscriptionPlan.findUniqueOrThrow({
    where: { code: invoice.planCode },
  });
  const current = await tx.subscription.findUnique({
    where: { companyId: invoice.companyId },
  });
  const now = new Date();
  // Paying before the current paid period ends extends it.
  const start =
    current?.status === "ACTIVE" &&
    current.currentPeriodEnd &&
    current.currentPeriodEnd > now
      ? current.currentPeriodEnd
      : now;
  const { end } = periodFrom(start, invoice.billingCycle as Cycle);
  const data = {
    planId: plan.id,
    status: "ACTIVE",
    billingCycle: invoice.billingCycle,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelledAt: null,
    renewalReminderSentAt: null,
  };
  await tx.subscription.upsert({
    where: { companyId: invoice.companyId },
    create: { ...data, companyId: invoice.companyId },
    update: data,
  });
  const addOns = await tx.addOn.findMany({
    where: { code: { in: purchase.addOns.map((a) => a.code) } },
  });
  await tx.subscriptionAddOn.updateMany({
    where: {
      companyId: invoice.companyId,
      cancelledAt: null,
      addOnId: { notIn: addOns.map((a) => a.id) },
    },
    data: { cancelledAt: now },
  });
  for (const a of addOns) {
    const quantity = purchase.addOns.find((x) => x.code === a.code)!.quantity;
    await tx.subscriptionAddOn.upsert({
      where: {
        companyId_addOnId: { companyId: invoice.companyId, addOnId: a.id },
      },
      create: { companyId: invoice.companyId, addOnId: a.id, quantity },
      update: { quantity, cancelledAt: null },
    });
  }
  if (invoice.couponCode)
    await tx.coupon.update({
      where: { code: invoice.couponCode },
      data: { redemptions: { increment: 1 } },
    });
}

async function tellAdmins(
  companyId: string,
  event: string,
  data: Record<string, unknown>,
) {
  const ids = await usersWithPermission(companyId, "company.write");
  await notify(companyId, ids, event, data, "/subscription").catch(
    () => undefined,
  );
}

// Company routes under /api/subscription.
export async function billingRoute(
  req: NextRequest,
  ctx: Context,
  path: string[],
) {
  const [, resource, id, action] = path;
  const method = req.method;
  requirePermission(ctx, "company.read");
  if (resource === "add-ons" && method === "GET")
    return (
      await db.addOn.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      })
    ).map((a) => ({
      ...a,
      priceMonthly: num(a.priceMonthly),
      priceAnnual: num(a.priceAnnual),
    }));
  if (resource === "invoices" && !id && method === "GET")
    return (
      await db.invoice.findMany({
        where: { companyId: ctx.companyId },
        include: {
          payments: {
            select: {
              provider: true,
              status: true,
              capturedAt: true,
              reference: true,
            },
          },
          refunds: {
            select: {
              amount: true,
              status: true,
              reason: true,
              createdAt: true,
            },
          },
        },
        orderBy: { issuedAt: "desc" },
        take: 100,
      })
    ).map(serializeInvoice);
  if (resource === "invoices" && id && action === "pdf" && method === "GET") {
    const inv = await db.invoice.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!inv) throw new AppError(404, "Invoice not found.", "NOT_FOUND");
    return invoicePdf(inv);
  }
  requirePermission(ctx, "company.write");
  if (resource === "billing-profile" && method === "PUT") {
    const b = profileSchema.parse(await json(req));
    return db.$transaction(async (tx) => {
      const saved = await tx.company.update({
        where: { id: ctx.companyId },
        data: {
          gstin: b.gstin,
          billingState: b.billingState,
          billingEmail: b.billingEmail,
          address: b.address,
        },
        select: {
          gstin: true,
          billingState: true,
          billingEmail: true,
          address: true,
        },
      });
      await audit(
        tx,
        ctx,
        "UPDATE",
        "billing_profile",
        ctx.companyId,
        undefined,
        { billingState: b.billingState },
        ip(req),
      );
      return saved;
    });
  }
  if (resource === "quote" && method === "POST") {
    const b = purchaseSchema.parse(await json(req));
    return (await resolve(db, ctx.companyId, b)).quote;
  }
  if (resource === "checkout" && method === "POST") {
    await rateLimit(`checkout:${ctx.companyId}`, 20);
    const b = purchaseSchema.parse(await json(req));
    const result = await db.$transaction(async (tx) => {
      const r = await resolve(tx, ctx.companyId, b);
      if (!r.company.billingState)
        throw new AppError(
          422,
          "Add your billing state (and GSTIN if registered) first.",
          "BILLING_PROFILE_REQUIRED",
        );
      const now = new Date();
      const { start, end } = periodFrom(now, b.cycle);
      const invoice = await tx.invoice.create({
        data: {
          companyId: ctx.companyId,
          number: await nextNumber(tx, now),
          planCode: r.plan.code,
          billingCycle: b.cycle,
          periodStart: start,
          periodEnd: end,
          currency: r.plan.currency,
          employees: r.quote.employees,
          lines: {
            items: r.quote.lines,
            purchase: b,
          } as unknown as Prisma.InputJsonValue,
          subtotal: r.quote.subtotal,
          discount: r.quote.discount,
          taxRate: r.quote.taxRate,
          cgst: r.quote.cgst,
          sgst: r.quote.sgst,
          igst: r.quote.igst,
          total: r.quote.total,
          couponCode: r.coupon?.code ?? null,
          billingName: r.company.name,
          billingGstin: r.company.gstin,
          billingAddress: r.company.address,
          billingState: r.company.billingState,
          placeOfSupply: r.company.billingState,
          dueDate: new Date(now.getTime() + 7 * day),
          createdBy: ctx.userId,
        },
      });
      await audit(
        tx,
        ctx,
        "CHECKOUT",
        "invoices",
        invoice.id,
        undefined,
        { number: invoice.number, total: r.quote.total },
        ip(req),
      );
      // A fully discounted purchase needs no payment.
      if (r.quote.total === 0) {
        const payment = await tx.payment.create({
          data: {
            companyId: ctx.companyId,
            invoiceId: invoice.id,
            provider: "NONE",
            amount: 0,
            reference: "Fully discounted",
          },
        });
        await capture(tx, payment, {});
        return { invoice, payment: { provider: "NONE", status: "CAPTURED" } };
      }
      if (!razorpayConfigured())
        return {
          invoice,
          payment: {
            provider: "MANUAL",
            status: "PENDING",
            instructions: `Pay ${r.quote.total} ${r.plan.currency} by bank transfer quoting ${invoice.number}. The subscription activates when the payment is confirmed.`,
          },
        };
      const order = await createOrder(
        Math.round(r.quote.total * 100),
        invoice.number,
      );
      await tx.payment.create({
        data: {
          companyId: ctx.companyId,
          invoiceId: invoice.id,
          provider: "RAZORPAY",
          providerOrderId: order.id,
          amount: r.quote.total,
          currency: r.plan.currency,
        },
      });
      return {
        invoice,
        payment: {
          provider: "RAZORPAY",
          status: "CREATED",
          orderId: order.id,
          keyId: process.env.RAZORPAY_KEY_ID,
          amountPaise: order.amount,
          currency: order.currency,
        },
      };
    });
    await tellAdmins(ctx.companyId, "invoice.issued", {
      number: result.invoice.number,
      amount: `${result.invoice.currency} ${Number(result.invoice.total).toFixed(2)}`,
      dueDate: result.invoice.dueDate.toISOString().slice(0, 10),
      provider: supplier().name,
    });
    return {
      invoice: serializeInvoice(result.invoice),
      payment: result.payment,
    };
  }
  // Razorpay checkout callback: the signature proves the payment.
  if (resource === "verify" && method === "POST") {
    const b = z
      .object({
        orderId: z.string().min(1).max(100),
        paymentId: z.string().min(1).max(100),
        signature: z.string().min(1).max(200),
      })
      .strict()
      .parse(await json(req));
    if (!verifyPaymentSignature(b.orderId, b.paymentId, b.signature))
      throw new AppError(
        400,
        "The payment signature is not valid.",
        "PAYMENT_SIGNATURE_INVALID",
      );
    const done = await db.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { companyId: ctx.companyId, providerOrderId: b.orderId },
      });
      if (!payment) throw new AppError(404, "Payment not found.", "NOT_FOUND");
      const first = await capture(tx, payment, {
        providerPaymentId: b.paymentId,
      });
      if (first)
        await audit(
          tx,
          ctx,
          "PAYMENT",
          "invoices",
          payment.invoiceId,
          undefined,
          { provider: "RAZORPAY" },
          ip(req),
        );
      return tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
    });
    await tellAdmins(ctx.companyId, "payment.received", {
      number: done.number,
      amount: `${done.currency} ${Number(done.total).toFixed(2)}`,
    });
    return serializeInvoice(done);
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

const serializeInvoice = <T extends Record<string, unknown>>(i: T) =>
  Object.fromEntries(
    Object.entries(i).map(([k, v]) => [
      k,
      v instanceof Prisma.Decimal ? Number(v) : v,
    ]),
  ) as { [K in keyof T]: T[K] extends Prisma.Decimal ? number : T[K] };

// Razorpay webhook (pre-authentication; the signature authenticates it).
export async function razorpayWebhook(req: NextRequest) {
  const raw = await req.text();
  if (
    !verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature") ?? "")
  )
    throw new AppError(
      401,
      "Invalid webhook signature.",
      "WEBHOOK_SIGNATURE_INVALID",
    );
  const event = JSON.parse(raw) as {
    event: string;
    payload: {
      payment?: {
        entity: {
          id: string;
          order_id: string;
          method?: string;
          error_description?: string;
        };
      };
      refund?: { entity: { id: string; status: string } };
    };
  };
  const entity = event.payload.payment?.entity;
  if (event.event.startsWith("payment.") && entity) {
    const payment = await withSystem(() =>
      db.payment.findUnique({ where: { providerOrderId: entity.order_id } }),
    );
    if (!payment) return { ignored: true };
    return withTenant(payment.companyId, () =>
      db.$transaction(async (tx) => {
        if (event.event === "payment.captured")
          return {
            captured: await capture(tx, payment, {
              providerPaymentId: entity.id,
              method: entity.method,
            }),
          };
        if (event.event === "payment.failed" && payment.status === "CREATED")
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "FAILED",
              failureReason: entity.error_description?.slice(0, 300),
            },
          });
        return { recorded: true };
      }),
    );
  }
  const refund = event.payload.refund?.entity;
  if (event.event.startsWith("refund.") && refund) {
    const row = await withSystem(() =>
      db.refund.findUnique({ where: { providerRefundId: refund.id } }),
    );
    if (!row) return { ignored: true };
    await withTenant(row.companyId, () =>
      db.refund.update({
        where: { id: row.id },
        data: {
          status:
            refund.status === "processed"
              ? "PROCESSED"
              : refund.status === "failed"
                ? "FAILED"
                : "PENDING",
        },
      }),
    );
    return { recorded: true };
  }
  return { ignored: true };
}

const decimal = (max: number) => z.number().min(0).max(max);
const addOnSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,30}$/),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().default(null),
    feature: z.string().trim().max(40).nullable().default(null),
    priceMonthly: decimal(10000000).nullable(),
    priceAnnual: decimal(100000000),
    perEmployee: z.boolean(),
    extraStorageMb: z.number().int().min(0).nullable().default(null),
    extraAiRequests: z.number().int().min(0).nullable().default(null),
    extraApiCalls: z.number().int().min(0).nullable().default(null),
    active: z.boolean(),
    public: z.boolean().default(true),
  })
  .strict();
const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{3,30}$/),
    description: z.string().trim().max(200).nullable().default(null),
    percentOff: z.number().min(0).max(100).nullable().default(null),
    amountOff: decimal(10000000).nullable().default(null),
    planCodes: z.array(z.string()).max(20).default([]),
    validFrom: z.iso.datetime({ offset: true }).nullable().default(null),
    validUntil: z.iso.datetime({ offset: true }).nullable().default(null),
    maxRedemptions: z.number().int().min(1).nullable().default(null),
    active: z.boolean(),
  })
  .strict()
  .refine((c) => (c.percentOff === null) !== (c.amountOff === null), {
    message: "Give either a percentage or an amount off.",
  });

// Super Admin billing routes under /api/platform (writes are Super Admin only;
// the caller enforces that).
export async function platformBilling(
  req: NextRequest,
  ctx: Context,
  resource: string,
  id?: string,
  action?: string,
) {
  const method = req.method;
  if (resource === "add-ons") {
    if (method === "GET")
      return (await db.addOn.findMany({ orderBy: { name: "asc" } })).map(
        serializeInvoice,
      );
    const b = addOnSchema.parse(await json(req));
    const saved = id
      ? await db.addOn.update({ where: { id }, data: b })
      : await db.addOn.create({ data: b });
    await audit(
      db,
      ctx,
      id ? "UPDATE" : "CREATE",
      "add_ons",
      saved.id,
      undefined,
      { code: b.code },
      ip(req),
    );
    return serializeInvoice(saved);
  }
  if (resource === "coupons") {
    if (method === "GET")
      return (await db.coupon.findMany({ orderBy: { createdAt: "desc" } })).map(
        serializeInvoice,
      );
    const b = couponSchema.parse(await json(req));
    const data = {
      ...b,
      validFrom: b.validFrom ? new Date(b.validFrom) : null,
      validUntil: b.validUntil ? new Date(b.validUntil) : null,
    };
    const saved = id
      ? await db.coupon.update({ where: { id }, data })
      : await db.coupon.create({ data });
    await audit(
      db,
      ctx,
      id ? "UPDATE" : "CREATE",
      "coupons",
      saved.id,
      undefined,
      { code: b.code },
      ip(req),
    );
    return serializeInvoice(saved);
  }
  if (resource === "invoices" && !id && method === "GET")
    return (
      await db.invoice.findMany({
        include: { company: { select: { name: true, code: true } } },
        orderBy: { issuedAt: "desc" },
        take: 300,
      })
    ).map(serializeInvoice);
  if (resource === "invoices" && id) {
    const inv = await db.invoice.findUnique({ where: { id } });
    if (!inv) throw new AppError(404, "Invoice not found.", "NOT_FOUND");
    if (action === "pdf" && method === "GET") return invoicePdf(inv);
    // Offline payments (bank transfer, cheque) confirmed by the provider.
    if (action === "mark-paid" && method === "POST") {
      const b = z
        .object({
          reference: z.string().trim().min(3).max(100),
          method: z.string().trim().max(40).default("BANK_TRANSFER"),
        })
        .strict()
        .parse(await json(req));
      if (inv.status !== "ISSUED")
        throw new AppError(409, "Only an unpaid invoice can be marked paid.");
      const paid = await withTenant(inv.companyId, () =>
        db.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              companyId: inv.companyId,
              invoiceId: inv.id,
              provider: "MANUAL",
              amount: inv.total,
              currency: inv.currency,
              reference: b.reference,
              method: b.method,
            },
          });
          await capture(tx, payment, {});
          return tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
        }),
      );
      await audit(
        db,
        ctx,
        "MARK_PAID",
        "invoices",
        inv.id,
        undefined,
        { number: inv.number, reference: b.reference },
        ip(req),
      );
      await withTenant(inv.companyId, () =>
        tellAdmins(inv.companyId, "payment.received", {
          number: inv.number,
          amount: `${inv.currency} ${Number(inv.total).toFixed(2)}`,
        }),
      );
      return serializeInvoice(paid);
    }
    if (action === "refund" && method === "POST") {
      const b = z
        .object({
          amount: z.number().positive().max(100000000),
          reason: z.string().trim().min(3).max(300),
        })
        .strict()
        .parse(await json(req));
      if (!["PAID", "PARTIALLY_REFUNDED"].includes(inv.status))
        throw new AppError(409, "Only a paid invoice can be refunded.");
      const left = Number(inv.total) - Number(inv.refundedAmount);
      if (b.amount > left + 0.001)
        throw new AppError(422, `At most ${left.toFixed(2)} can be refunded.`);
      const result = await withTenant(inv.companyId, async () => {
        const payment = await db.payment.findFirst({
          where: {
            invoiceId: inv.id,
            status: { in: ["CAPTURED", "REFUNDED"] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (!payment) throw new AppError(409, "No captured payment to refund.");
        const provider =
          payment.provider === "RAZORPAY" && payment.providerPaymentId
            ? await refundPayment(
                payment.providerPaymentId,
                Math.round(b.amount * 100),
                b.reason,
              )
            : null;
        return db.$transaction(async (tx) => {
          const refund = await tx.refund.create({
            data: {
              companyId: inv.companyId,
              invoiceId: inv.id,
              paymentId: payment.id,
              amount: b.amount,
              reason: b.reason,
              status:
                !provider || provider.status === "processed"
                  ? "PROCESSED"
                  : "PENDING",
              providerRefundId: provider?.id,
              createdBy: ctx.userId,
            },
          });
          const refunded = Number(inv.refundedAmount) + b.amount;
          const full = refunded >= Number(inv.total) - 0.001;
          await tx.invoice.update({
            where: { id: inv.id },
            data: {
              refundedAmount: refunded,
              status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
            },
          });
          if (full)
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            });
          return refund;
        });
      });
      await audit(
        db,
        ctx,
        "REFUND",
        "invoices",
        inv.id,
        undefined,
        { amount: b.amount, reason: b.reason },
        ip(req),
      );
      return serializeInvoice(result);
    }
  }
  if (resource === "jobs" && id === "billing-reminders" && method === "POST")
    return billingReminders();
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// Trial-ending (3 days) and renewal-due (7 days) reminders, each sent once.
export async function billingReminders() {
  const now = new Date();
  const subs = await withSystem(() =>
    db.subscription.findMany({
      where: {
        OR: [
          {
            status: "TRIAL",
            trialReminderSentAt: null,
            trialEndsAt: { gt: now, lte: new Date(now.getTime() + 3 * day) },
          },
          {
            status: "ACTIVE",
            renewalReminderSentAt: null,
            currentPeriodEnd: {
              gt: now,
              lte: new Date(now.getTime() + 7 * day),
            },
          },
        ],
      },
      select: {
        id: true,
        companyId: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    }),
  );
  let trial = 0,
    renewal = 0;
  for (const s of subs)
    await withTenant(s.companyId, async () => {
      const isTrial = s.status === "TRIAL";
      const date = (isTrial ? s.trialEndsAt : s.currentPeriodEnd)!
        .toISOString()
        .slice(0, 10);
      await tellAdmins(
        s.companyId,
        isTrial ? "subscription.trial_ending" : "subscription.renewal_due",
        { date },
      );
      await db.subscription.update({
        where: { id: s.id },
        data: isTrial
          ? { trialReminderSentAt: now }
          : { renewalReminderSentAt: now },
      });
      if (isTrial) trial++;
      else renewal++;
    });
  return { trialReminders: trial, renewalReminders: renewal };
}

// GST tax invoice.
async function invoicePdf(inv: {
  number: string;
  issuedAt: Date;
  dueDate: Date;
  status: string;
  billingName: string;
  billingGstin: string | null;
  billingAddress: string | null;
  placeOfSupply: string | null;
  periodStart: Date;
  periodEnd: Date;
  lines: Prisma.JsonValue;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  cgst: Prisma.Decimal;
  sgst: Prisma.Decimal;
  igst: Prisma.Decimal;
  total: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  couponCode: string | null;
}) {
  const s = supplier();
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const m = 45;
  const t = (v: string, x: number, size = 9, f = font) =>
    page.drawText(pdfText(v), {
      x,
      y,
      size,
      font: f,
      color: rgb(0.1, 0.1, 0.1),
    });
  const r = (v: string, x: number, size = 9, f = font) =>
    page.drawText(pdfText(v), {
      x: x - f.widthOfTextAtSize(pdfText(v), size),
      y,
      size,
      font: f,
    });
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const money = (v: Prisma.Decimal | number) => Number(v).toFixed(2);
  t("TAX INVOICE", m, 16, bold);
  r(inv.number, 550, 11, bold);
  y -= 18;
  r(`Date ${d(inv.issuedAt)} · Due ${d(inv.dueDate)} · ${inv.status}`, 550, 8);
  y -= 26;
  t(s.name, m, 11, bold);
  t("Bill to", 320, 9, bold);
  y -= 14;
  t(s.gstin ? `GSTIN ${s.gstin}` : "GSTIN not configured", m, 8);
  t(inv.billingName, 320, 10, bold);
  y -= 12;
  t(`${s.address ?? ""} ${s.state}`.trim().slice(0, 60), m, 8);
  t(inv.billingGstin ? `GSTIN ${inv.billingGstin}` : "Unregistered", 320, 8);
  y -= 12;
  t(`Place of supply: ${inv.placeOfSupply ?? "-"}`, 320, 8);
  y -= 12;
  if (inv.billingAddress) t(inv.billingAddress.slice(0, 60), 320, 8);
  y -= 24;
  t(
    `Service period ${d(inv.periodStart)} to ${d(inv.periodEnd)} · SAC 998314`,
    m,
    8,
  );
  y -= 18;
  page.drawRectangle({
    x: m,
    y: y - 4,
    width: 505,
    height: 16,
    color: rgb(0.93, 0.94, 0.97),
  });
  t("Description", m + 4, 9, bold);
  r("Qty", 380, 9, bold);
  r("Rate", 460, 9, bold);
  r("Amount", 546, 9, bold);
  y -= 18;
  for (const l of (inv.lines as { items: Line[] }).items) {
    t(l.description.slice(0, 60), m + 4);
    r(String(l.quantity), 380);
    r(l.unitPrice.toFixed(2), 460);
    r(l.amount.toFixed(2), 546);
    y -= 14;
  }
  y -= 8;
  const rows: [string, string][] = [
    ["Subtotal", money(inv.subtotal)],
    ...(Number(inv.discount)
      ? [
          [
            `Discount${inv.couponCode ? ` (${inv.couponCode})` : ""}`,
            `-${money(inv.discount)}`,
          ] as [string, string],
        ]
      : []),
    ...(Number(inv.igst)
      ? [[`IGST ${Number(inv.taxRate)}%`, money(inv.igst)] as [string, string]]
      : [
          [`CGST ${Number(inv.taxRate) / 2}%`, money(inv.cgst)] as [
            string,
            string,
          ],
          [`SGST ${Number(inv.taxRate) / 2}%`, money(inv.sgst)] as [
            string,
            string,
          ],
        ]),
  ];
  for (const [k, v] of rows) {
    r(k, 460);
    r(v, 546);
    y -= 14;
  }
  r("Total (INR)", 460, 10, bold);
  r(money(inv.total), 546, 10, bold);
  y -= 16;
  if (Number(inv.refundedAmount)) {
    r("Refunded", 460);
    r(money(inv.refundedAmount), 546);
  }
  y = 60;
  t(
    "This is a computer-generated invoice. Card details are handled by the payment provider and never stored.",
    m,
    7,
  );
  return new NextResponse(new Uint8Array(await doc.save()), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${inv.number.replaceAll("/", "-")}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
