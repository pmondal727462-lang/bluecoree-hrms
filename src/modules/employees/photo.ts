import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/uploads";
import { deleteFile, putFile, signedUrl } from "@/lib/storage";
import {
  audit,
  ip,
  json,
  rateLimit,
  requirePermission,
  type Context,
} from "@/modules/auth/service";
import { assertStorage } from "@/modules/saas/service";
import { linkedEmployee } from "@/modules/shared/team";

const photoTypes = ["image/png", "image/jpeg"];
const maxPhotoBytes = 1024 * 1024;
const photoSchema = z
  .object({
    file: z
      .object({
        name: z.string().min(1).max(200),
        type: z.string().max(120),
        base64: z.string().max(1_500_000),
      })
      .strict(),
  })
  .strict();

// Employee photos are private files. HR with employees.write manages any
// employee's photo; employees with profile.write manage their own. Reading
// needs employees.read or one's own profile.
export async function employeePhoto(
  req: NextRequest,
  ctx: Context,
  employeeId: string | "me",
) {
  const me = await linkedEmployee(ctx);
  const own = employeeId === "me" || employeeId === me?.id;
  const id = employeeId === "me" ? me?.id : employeeId;
  if (!id)
    throw new AppError(403, "Your account needs a linked employee record.");
  const read = req.method === "GET";
  if (own)
    requirePermission(
      ctx,
      read
        ? ctx.permissions.includes("employees.read")
          ? "employees.read"
          : "profile.read"
        : ctx.permissions.includes("employees.write")
          ? "employees.write"
          : "profile.write",
    );
  else requirePermission(ctx, read ? "employees.read" : "employees.write");
  const employee = await db.employee.findFirst({
    where: { id, companyId: ctx.companyId },
    select: {
      id: true,
      employeeCode: true,
      photoKey: true,
      photoType: true,
    },
  });
  if (!employee) throw new AppError(404, "Employee not found.", "NOT_FOUND");

  if (read) {
    if (!employee.photoKey || !employee.photoType) return { url: null };
    return {
      url: await signedUrl(employee.photoKey, {
        fileName: `${employee.employeeCode}-photo.${employee.photoType === "image/png" ? "png" : "jpg"}`,
        contentType: employee.photoType,
        inline: true,
      }),
      expiresInSeconds: 300,
    };
  }
  if (req.method === "PUT") {
    await rateLimit(`photo:${ctx.userId}`, 20);
    const b = photoSchema.parse(await json(req, 1_600_000));
    const upload = validateUpload(b.file, maxPhotoBytes);
    if (!photoTypes.includes(upload.type))
      throw new AppError(422, "Upload a PNG or JPEG photo.");
    await assertStorage(ctx.companyId, upload.bytes.length);
    const stored = await putFile(ctx.companyId, upload.bytes, upload.type);
    try {
      await db.$transaction(async (tx) => {
        await tx.employee.update({
          where: {
            id_companyId: { id: employee.id, companyId: ctx.companyId },
          },
          data: {
            photoKey: stored.key,
            photoType: upload.type,
            photoSize: upload.bytes.length,
          },
        });
        await audit(
          tx,
          ctx,
          "PHOTO_UPDATE",
          "employees",
          employee.id,
          undefined,
          { size: upload.bytes.length, type: upload.type },
          ip(req),
        );
      });
    } catch (error) {
      await deleteFile(stored.key);
      throw error;
    }
    if (employee.photoKey) await deleteFile(employee.photoKey);
    return { updated: true };
  }
  if (req.method === "DELETE") {
    if (!employee.photoKey) return { deleted: false };
    await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id_companyId: { id: employee.id, companyId: ctx.companyId } },
        data: { photoKey: null, photoType: null, photoSize: null },
      });
      await audit(
        tx,
        ctx,
        "PHOTO_DELETE",
        "employees",
        employee.id,
        undefined,
        undefined,
        ip(req),
      );
    });
    await deleteFile(employee.photoKey);
    return { deleted: true };
  }
  throw new AppError(405, "Method not allowed.");
}
