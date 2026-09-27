import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "./errors";

// Private file storage. Local disk (outside the web root) in development;
// any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) when configured.
// Object keys are random and never derived from user-supplied file names.
const s3Configured = () =>
  !!(
    process.env.STORAGE_ENDPOINT &&
    process.env.STORAGE_BUCKET &&
    process.env.STORAGE_ACCESS_KEY &&
    process.env.STORAGE_SECRET_KEY
  );
let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || "auto",
    forcePathStyle: process.env.STORAGE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.STORAGE_SECRET_KEY!,
    },
  });
  return client;
}
const localRoot = () =>
  path.resolve(
    /*turbopackIgnore: true*/ process.env.LOCAL_STORAGE_DIR || "data/uploads",
  );
function localPath(key: string) {
  if (!/^[a-z0-9]+(\/[a-z0-9]+)*$/i.test(key))
    throw new AppError(400, "Invalid file key.");
  return path.join(/*turbopackIgnore: true*/ localRoot(), ...key.split("/"));
}

export function storageDriver() {
  return s3Configured() ? "s3" : "local";
}
export async function putFile(
  companyId: string,
  bytes: Buffer,
  contentType: string,
) {
  const key = `${companyId}/${randomBytes(20).toString("hex")}`;
  if (s3Configured())
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption:
          process.env.STORAGE_SSE === "false" ? undefined : "AES256",
      }),
    );
  else {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { mode: 0o600 });
  }
  return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export async function readFileBytes(key: string) {
  if (!s3Configured()) return readFile(localPath(key));
  const res = await s3().send(
    new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }),
  );
  return Buffer.from(await res.Body!.transformToByteArray());
}
export async function deleteFile(key: string) {
  if (s3Configured())
    await s3().send(
      new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }),
    );
  else await rm(localPath(key), { force: true });
}

// Short-lived download links. For S3 this is a presigned URL; locally it is
// an HMAC-signed token served by /api/files.
const secret = () => process.env.JWT_SECRET || "";
export async function signedUrl(
  key: string,
  options: {
    fileName: string;
    contentType: string;
    inline?: boolean;
    seconds?: number;
  },
) {
  const seconds = options.seconds ?? 300;
  const disposition = `${options.inline ? "inline" : "attachment"}; filename="${options.fileName.replace(/["\\\r\n]/g, "")}"`;
  if (s3Configured())
    return getSignedUrl(
      s3(),
      new GetObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: key,
        ResponseContentDisposition: disposition,
        ResponseContentType: options.contentType,
      }),
      { expiresIn: seconds },
    );
  const payload = Buffer.from(
    JSON.stringify({
      k: key,
      d: disposition,
      t: options.contentType,
      e: Date.now() + seconds * 1000,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  return `/api/files/${payload}.${sig}`;
}
export async function redeemSignedUrl(token: string) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw new AppError(404, "File not found.");
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new AppError(404, "File not found.");
  const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    k: string;
    d: string;
    t: string;
    e: number;
  };
  if (p.e < Date.now())
    throw new AppError(410, "This download link has expired.");
  return {
    bytes: await readFileBytes(p.k),
    disposition: p.d,
    contentType: p.t,
  };
}
