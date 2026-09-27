import { randomBytes } from "node:crypto";
import { companyAppUrl } from "@/modules/saas/branding";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { db, withTenant } from "@/lib/db";
import { digest } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { pdfText } from "@/lib/export";
import { emailConfigured, sendAuthEmail } from "@/integrations/email";
import {
  audit,
  ip,
  json,
  rateLimit,
  type Context,
} from "@/modules/auth/service";
import { notify } from "@/modules/notifications/service";
import { dayDate } from "@/modules/time/rules";

type Tx = Prisma.TransactionClient;
const text = (max: number) => z.string().trim().max(max);
const offerSchema = z
  .object({
    annualCtc: z.number().finite().min(0).max(1000000000),
    joiningDate: z.iso.date(),
    expiresOn: z.iso.date(),
    designationId: z.string().nullable().default(null),
    departmentId: z.string().nullable().default(null),
    terms: text(10000).nullable().default(null),
  })
  .strict()
  .refine((o) => o.expiresOn <= o.joiningDate, {
    message: "The offer must expire on or before the joining date.",
  });
const closedStages = ["HIRED", "REJECTED", "WITHDRAWN"];
const today = () => new Date().toISOString().slice(0, 10);
const live = ["DRAFT", "SENT", "ACCEPTED"];

async function stage(
  tx: Tx,
  ctx: { companyId: string; userId: string; name: string },
  c: { id: string; stage: string },
  to: string,
  note: string,
) {
  if (c.stage !== to)
    await tx.candidate.update({ where: { id: c.id }, data: { stage: to } });
  await tx.candidateEvent.create({
    data: {
      companyId: ctx.companyId,
      candidateId: c.id,
      fromStage: c.stage,
      toStage: to,
      note,
      actorId: ctx.userId,
      actorName: ctx.name,
    },
  });
}
async function findOffer(ctx: Context, id: string, tx: Tx | typeof db = db) {
  const o = await tx.offer.findFirst({
    where: { id, companyId: ctx.companyId },
    include: {
      candidate: {
        select: {
          id: true,
          name: true,
          email: true,
          stage: true,
          job: { select: { title: true } },
        },
      },
      designation: { select: { name: true } },
      department: { select: { name: true } },
    },
  });
  if (!o) throw new AppError(404, "Offer not found.", "NOT_FOUND");
  return o;
}
// An unanswered offer past its expiry date counts as expired.
const view = <T extends { status: string; expiresOn: Date }>(o: T) => ({
  ...o,
  tokenHash: undefined,
  expired:
    o.status === "SENT" && o.expiresOn.toISOString().slice(0, 10) < today(),
});

// Offers for a candidate: create (candidates/:id/offers) and list.
export async function candidateOffers(
  req: NextRequest,
  ctx: Context,
  candidateId: string,
) {
  if (req.method === "GET") {
    const offers = await db.offer.findMany({
      where: { companyId: ctx.companyId, candidateId },
      orderBy: { createdAt: "desc" },
    });
    return offers.map(view);
  }
  const b = offerSchema.parse(await json(req));
  if (b.expiresOn < today())
    throw new AppError(422, "The expiry date must be today or later.");
  return db.$transaction(async (tx) => {
    const c = await tx.candidate.findFirst({
      where: { id: candidateId, companyId: ctx.companyId },
    });
    if (!c) throw new AppError(404, "Candidate not found.");
    if (closedStages.includes(c.stage))
      throw new AppError(409, "This candidate is no longer in process.");
    if (
      await tx.offer.findFirst({
        where: { candidateId: c.id, status: { in: live } },
      })
    )
      throw new AppError(
        409,
        "Withdraw the current offer before making a new one.",
      );
    for (const [model, value] of [
      ["department", b.departmentId],
      ["designation", b.designationId],
    ] as const)
      if (
        value &&
        !(await (tx[model] as typeof tx.department).findFirst({
          where: { id: value, companyId: ctx.companyId },
        }))
      )
        throw new AppError(404, `The selected ${model} was not found.`);
    const saved = await tx.offer.create({
      data: {
        ...b,
        joiningDate: dayDate(b.joiningDate),
        expiresOn: dayDate(b.expiresOn),
        companyId: ctx.companyId,
        candidateId: c.id,
        createdBy: ctx.userId,
      },
    });
    await stage(tx, ctx, c, "OFFER", "Offer prepared");
    await audit(
      tx,
      ctx,
      "CREATE",
      "offers",
      saved.id,
      undefined,
      { candidateId: c.id, joiningDate: b.joiningDate },
      ip(req),
    );
    return view(saved);
  });
}

// recruitment/offers/:id[/send|withdraw|letter]
export async function offersRoute(
  req: NextRequest,
  ctx: Context,
  id: string,
  action?: string,
) {
  if (!action && req.method === "GET") return view(await findOffer(ctx, id));
  if (action === "letter" && req.method === "GET")
    return letter(await findOffer(ctx, id), ctx.companyId);
  if (action === "send" && req.method === "POST") {
    const token = randomBytes(32).toString("base64url");
    const o = await db.$transaction(async (tx) => {
      const o = await findOffer(ctx, id, tx);
      if (!["DRAFT", "SENT"].includes(o.status))
        throw new AppError(409, "Only a draft or sent offer can be sent.");
      if (o.expiresOn.toISOString().slice(0, 10) < today())
        throw new AppError(409, "The offer has expired. Make a new offer.");
      await tx.offer.update({
        where: { id: o.id },
        data: { status: "SENT", sentAt: new Date(), tokenHash: digest(token) },
      });
      await audit(
        tx,
        ctx,
        "SEND",
        "offers",
        o.id,
        undefined,
        undefined,
        ip(req),
      );
      return o;
    });
    const link = `${await companyAppUrl(ctx.companyId)}/offer/${token}`;
    let emailed = false;
    if (emailConfigured()) {
      const company = await db.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { name: true },
      });
      await sendAuthEmail(
        o.candidate.email,
        `Your offer from ${company.name}`,
        `Hello ${o.candidate.name},\n\nWe are pleased to offer you the role of ${o.designation?.name ?? o.candidate.job.title}. Review and respond to your offer before ${o.expiresOn.toISOString().slice(0, 10)}:\n${link}`,
      )
        .then(() => (emailed = true))
        .catch(() => undefined);
    }
    return { link, emailed };
  }
  if (action === "withdraw" && req.method === "POST") {
    const b = z
      .object({ note: text(500).min(3) })
      .strict()
      .parse(await json(req));
    return db.$transaction(async (tx) => {
      const o = await findOffer(ctx, id, tx);
      if (!["DRAFT", "SENT", "ACCEPTED"].includes(o.status))
        throw new AppError(409, "This offer is already closed.");
      if (o.candidate.stage === "HIRED")
        throw new AppError(409, "The candidate has already joined.");
      const saved = await tx.offer.update({
        where: { id: o.id },
        data: { status: "WITHDRAWN", tokenHash: null, responseNote: b.note },
      });
      await stage(
        tx,
        ctx,
        o.candidate,
        o.candidate.stage,
        `Offer withdrawn: ${b.note}`,
      );
      await audit(
        tx,
        ctx,
        "WITHDRAW",
        "offers",
        o.id,
        { status: o.status },
        { status: "WITHDRAWN", note: b.note },
        ip(req),
      );
      return view(saved);
    });
  }
  throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
}

// The latest offer must be accepted before a candidate with offers is hired.
export async function acceptedOffer(tx: Tx, candidateId: string) {
  const latest = await tx.offer.findFirst({
    where: { candidateId, status: { not: "WITHDRAWN" } },
    orderBy: { createdAt: "desc" },
  });
  const any = latest
    ? latest
    : await tx.offer.findFirst({ where: { candidateId } });
  if (any && latest?.status !== "ACCEPTED")
    throw new AppError(
      409,
      "The candidate has not accepted the offer.",
      "OFFER_NOT_ACCEPTED",
    );
  return latest;
}

// Candidate's private link: view, accept or decline.
export async function offerPortal(req: NextRequest, token: string) {
  await rateLimit(`offer-portal:${ip(req)}`, 60);
  const found = await db.offer.findFirst({
    where: { tokenHash: digest(token) },
    select: { id: true, companyId: true },
  });
  if (!found)
    throw new AppError(404, "This offer link is invalid.", "NOT_FOUND");
  return withTenant(found.companyId, async () => {
    const o = await db.offer.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        candidate: {
          select: {
            id: true,
            name: true,
            stage: true,
            job: { select: { title: true } },
          },
        },
        designation: { select: { name: true } },
        department: { select: { name: true } },
        company: { select: { name: true } },
      },
    });
    const expired = o.expiresOn.toISOString().slice(0, 10) < today();
    if (req.method === "GET")
      return {
        company: o.company.name,
        candidate: o.candidate.name,
        role: o.designation?.name ?? o.candidate.job.title,
        department: o.department?.name ?? null,
        annualCtc: o.annualCtc,
        joiningDate: o.joiningDate,
        expiresOn: o.expiresOn,
        terms: o.terms,
        status: o.status === "SENT" && expired ? "EXPIRED" : o.status,
      };
    if (req.method !== "POST")
      throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
    const b = z
      .object({
        decision: z.enum(["ACCEPT", "DECLINE"]),
        note: text(1000).optional(),
      })
      .strict()
      .parse(await json(req));
    if (o.status !== "SENT")
      throw new AppError(
        409,
        "This offer has already been answered or withdrawn.",
      );
    if (expired) throw new AppError(410, "This offer has expired.", "EXPIRED");
    const status = b.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    await db.$transaction(async (tx) => {
      // The status guard makes a double submission a no-op.
      const done = await tx.offer.updateMany({
        where: { id: o.id, status: "SENT" },
        data: { status, respondedAt: new Date(), responseNote: b.note },
      });
      if (!done.count)
        throw new AppError(409, "This offer has already been answered.");
      await stage(
        tx,
        { companyId: o.companyId, userId: "candidate", name: o.candidate.name },
        o.candidate,
        o.candidate.stage,
        `Offer ${status.toLowerCase()} by the candidate${b.note ? `: ${b.note}` : ""}`,
      );
    });
    await notify(
      o.companyId,
      [o.createdBy],
      "offer.responded",
      {
        candidate: o.candidate.name,
        job: o.candidate.job.title,
        decision: status.toLowerCase(),
        note: b.note ?? "",
      },
      "/recruitment",
    ).catch(() => undefined);
    return { status };
  });
}

async function letter(
  o: Awaited<ReturnType<typeof findOffer>>,
  companyId: string,
) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      address: true,
      branding: { select: { brandName: true } },
    },
  });
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const m = 56;
  let y = 842 - m;
  const line = (s: string, f = font, size = 10.5, gap = 16) => {
    // Wraps to the page width.
    const words = pdfText(s).split(" ");
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > 595 - m * 2) {
        page.drawText(cur, {
          x: m,
          y,
          size,
          font: f,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= gap;
        cur = w;
      } else cur = next;
    }
    if (cur)
      page.drawText(cur, { x: m, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= gap;
  };
  const d = (x: Date) =>
    x.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  line(company.branding?.brandName || company.name, bold, 15, 18);
  if (company.address) line(company.address, font, 9, 26);
  line(`Date: ${d(o.sentAt ?? o.createdAt)}`);
  y -= 6;
  line(`Dear ${o.candidate.name},`, font, 10.5, 22);
  line("Letter of offer", bold, 12, 22);
  const role = o.designation?.name ?? o.candidate.job.title;
  line(
    `We are pleased to offer you the position of ${role}${o.department ? ` in the ${o.department.name} department` : ""} at ${company.name}.`,
  );
  line(
    `Your annual cost to company will be Rs. ${o.annualCtc.toLocaleString("en-IN")}, and your expected date of joining is ${d(o.joiningDate)}.`,
  );
  line(
    `Please confirm your acceptance by ${d(o.expiresOn)}, after which this offer lapses.`,
    font,
    10.5,
    22,
  );
  if (o.terms) {
    line("Terms", bold, 11, 18);
    for (const p of o.terms.split(/\n+/)) line(p);
    y -= 6;
  }
  line("We look forward to welcoming you.", font, 10.5, 30);
  line(`For ${company.name}`, bold);
  return new NextResponse(new Uint8Array(await doc.save()), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="offer-letter.pdf"`,
      "cache-control": "no-store",
    },
  });
}
