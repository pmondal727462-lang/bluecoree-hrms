import { NextRequest } from "next/server";
import { companyAppUrl } from "@/modules/saas/branding";
import { z } from "zod";
import { db, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/uploads";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage } from "@/modules/saas/service";
import { enqueueWebhook } from "@/modules/integrations/outbound";
import { notify } from "@/modules/notifications/service";
import { dayDate } from "@/modules/time/rules";

const text = (max: number) => z.string().trim().max(max);
const applySchema = z
  .object({
    name: text(120).min(2),
    email: z
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    phone: text(30).optional(),
    currentCompany: text(120).optional(),
    experienceYears: z.number().min(0).max(60).optional(),
    coverNote: text(2000).optional(),
    resume: z
      .object({
        name: z.string().min(1).max(200),
        type: z.string().max(100),
        base64: z.string().max(2_900_000),
      })
      .strict(),
    consent: z.literal(true, {
      error: "Agree to the processing of your application data.",
    }),
    // Honeypot: people never fill it in; form bots do.
    website: z.string().max(200).optional(),
  })
  .strict();
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    intro: text(2000).nullable().default(null),
  })
  .strict();

const careersUrl = async (companyId: string, code: string) =>
  `${await companyAppUrl(companyId)}/careers/${encodeURIComponent(code)}`;

// Company setting for the public careers page.
export async function careersSettings(req: NextRequest, ctx: Context) {
  requirePermission(ctx, "recruitment.manage");
  if (req.method === "GET") {
    const c = await db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { code: true, careersEnabled: true, careersIntro: true },
    });
    return {
      enabled: c.careersEnabled,
      intro: c.careersIntro,
      url: await careersUrl(ctx.companyId, c.code),
    };
  }
  if (req.method !== "PUT")
    throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
  const b = settingsSchema.parse(await json(req));
  return db.$transaction(async (tx) => {
    const c = await tx.company.update({
      where: { id: ctx.companyId },
      data: { careersEnabled: b.enabled, careersIntro: b.intro },
      select: { code: true, careersEnabled: true, careersIntro: true },
    });
    await audit(
      tx,
      ctx,
      "UPDATE",
      "careers_page",
      ctx.companyId,
      undefined,
      { enabled: b.enabled },
      ip(req),
    );
    return {
      enabled: c.careersEnabled,
      intro: c.careersIntro,
      url: await careersUrl(ctx.companyId, c.code),
    };
  });
}

const openJobs = (companyId: string) => ({
  companyId,
  status: "OPEN",
  OR: [{ closesOn: null }, { closesOn: { gte: dayDate(today()) } }],
});
const today = () => new Date().toISOString().slice(0, 10);

// Public careers page: open jobs and applications (spec §26). Runs without
// a session; the company code in the URL selects the tenant.
export async function careersRoute(req: NextRequest, path: string[]) {
  const [, , code, resource, jobId, action] = path;
  await rateLimit(`careers:${ip(req)}`, req.method === "GET" ? 300 : 20);
  const company = await db.company.findFirst({
    where: { code: code ?? "", careersEnabled: true, status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      name: true,
      website: true,
      careersIntro: true,
    },
  });
  if (!company)
    throw new AppError(404, "This careers page is not available.", "NOT_FOUND");
  return withTenant(company.id, async () => {
    if (req.method === "GET" && !resource) {
      const jobs = await db.jobOpening.findMany({
        where: openJobs(company.id),
        select: {
          id: true,
          title: true,
          location: true,
          employmentType: true,
          openings: true,
          closesOn: true,
          description: true,
          createdAt: true,
          department: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return {
        company: {
          code: company.code,
          name: company.name,
          website: company.website,
          intro: company.careersIntro,
        },
        jobs,
      };
    }
    if (
      resource === "jobs" &&
      jobId &&
      action === "apply" &&
      req.method === "POST"
    ) {
      const b = applySchema.parse(await json(req, 3_000_000));
      const job = await db.jobOpening.findFirst({
        where: { ...openJobs(company.id), id: jobId },
      });
      if (!job)
        throw new AppError(404, "This job is no longer open.", "NOT_FOUND");
      const received = {
        received: true,
        message: `Thank you. Your application for ${job.title} has been received.`,
      };
      // Silently drop bot submissions and repeat applications, without
      // revealing whether an address has applied before.
      if (b.website) return received;
      const upload = validateUpload(b.resume);
      if (upload.type !== "application/pdf")
        throw new AppError(422, "Upload your resume as a PDF.");
      if (
        await db.candidate.findFirst({
          where: { jobId: job.id, email: b.email },
          select: { id: true },
        })
      )
        return received;
      await assertStorage(company.id, upload.bytes.length);
      const saved = await db
        .$transaction(async (tx) => {
          const c = await tx.candidate.create({
            data: {
              companyId: company.id,
              jobId: job.id,
              name: b.name,
              email: b.email,
              phone: b.phone,
              currentCompany: b.currentCompany,
              experienceYears: b.experienceYears,
              notes: b.coverNote,
              source: "Careers page",
              consentAt: new Date(),
              resumeName: upload.name,
              resumeType: upload.type,
              resumeSize: upload.bytes.length,
              resumeData: upload.bytes,
            },
          });
          await tx.candidateEvent.create({
            data: {
              companyId: company.id,
              candidateId: c.id,
              toStage: "APPLIED",
              note: "Applied through the careers page",
              actorId: "careers-page",
              actorName: b.name,
            },
          });
          await enqueueWebhook(tx, company.id, "candidate.created", {
            id: c.id,
            jobId: job.id,
            jobTitle: job.title,
            name: c.name,
          });
          return c;
        })
        // A simultaneous repeat application hits the unique index.
        .catch((e: unknown) => {
          if ((e as { code?: string }).code === "P2002") return null;
          throw e;
        });
      if (!saved) return received;
      // Recruiters with access to the job's pipeline are told.
      const recruiters = await db.user.findMany({
        where: {
          companyId: company.id,
          active: true,
          role: {
            permissions: { some: { permissionKey: "recruitment.manage" } },
          },
        },
        select: { id: true },
        take: 50,
      });
      await notify(
        company.id,
        recruiters.map((r) => r.id),
        "candidate.applied",
        { candidate: saved.name, job: job.title },
        "/recruitment",
      ).catch(() => undefined);
      return received;
    }
    throw new AppError(404, "Endpoint not found.", "NOT_FOUND");
  });
}
