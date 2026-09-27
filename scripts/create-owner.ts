import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { systemDb as db } from "../src/lib/db";

// Local operator command; never exposed through the public signup API.
async function main() {
  const [email, name] = z
    .tuple([z.string().email().toLowerCase(), z.string().trim().min(1)])
    .parse(process.argv.slice(2));
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  const owner = await db.$transaction(
    async (tx) => {
      if (await tx.user.findFirst({ where: { email } }))
        throw new Error(
          "This email already has an account. No credentials or permissions were changed.",
        );
      const provider = await tx.user.findFirst({
        where: { isSuperAdmin: true },
        orderBy: { createdAt: "asc" },
        select: { companyId: true },
      });
      if (!provider)
        throw new Error("Complete initial installation setup first.");
      const role = await tx.role.findUniqueOrThrow({
        where: {
          companyId_name: {
            companyId: provider.companyId,
            name: "Super Admin",
          },
        },
      });
      const user = await tx.user.create({
        data: {
          companyId: provider.companyId,
          roleId: role.id,
          name,
          email,
          passwordHash,
          isSuperAdmin: true,
          mustChangePassword: true,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: provider.companyId,
          actorId: user.id,
          actorName: "Local owner provisioning",
          action: "OWNER_CREATED",
          module: "users",
          recordId: user.id,
          newValue: { name, email, isSuperAdmin: true },
        },
      });
      return user;
    },
    { isolationLevel: "Serializable" },
  );
  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/owner-credentials.txt",
    [
      "BlueCoreeHR software owner",
      `Login: ${process.env.APP_URL || "http://localhost:3000"}/owner/login`,
      `Name: ${owner.name}`,
      `Email: ${owner.email}`,
      `Temporary password: ${password}`,
      "Choose your own password at first sign-in, then sign in again.",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  console.log(
    "Owner account created. Temporary credentials saved to ignored data/owner-credentials.txt.",
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Owner creation failed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
