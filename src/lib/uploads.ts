import { AppError } from "./errors";

// Allow-list of accepted file types. Anything else, including HTML, SVG,
// scripts and executables, is refused regardless of its declared type.
const allowed: Record<
  string,
  { extensions: string[]; check: (bytes: Buffer) => boolean }
> = {
  "application/pdf": {
    extensions: ["pdf"],
    check: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  },
  "image/png": {
    extensions: ["png"],
    check: (b) =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/jpeg": {
    extensions: ["jpg", "jpeg"],
    check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  // Office Open XML documents are ZIP containers; macro-enabled variants
  // (.docm/.xlsm) are not accepted.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extensions: ["docx"],
    check: (b) =>
      b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
      b.includes(Buffer.from("word/")),
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extensions: ["xlsx"],
    check: (b) =>
      b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
      b.includes(Buffer.from("xl/")),
  },
  "text/plain": {
    extensions: ["txt", "log"],
    check: (b) => {
      if (b.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(b);
        return !/<\s*(script|html|svg|iframe)/i.test(b.toString("utf8"));
      } catch {
        return false;
      }
    },
  },
};
export const maxUploadBytes = 2 * 1024 * 1024;
// Display name only; stored files are never addressed by this name.
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return clean || "file";
}
export function validateUpload(
  input: { name: string; type: string; base64: string },
  maxBytes = maxUploadBytes,
) {
  const rule = allowed[input.type];
  const name = safeFileName(input.name);
  const extension = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : "";
  if (!rule || !rule.extensions.includes(extension))
    throw new AppError(
      422,
      "Attach a PDF, PNG, JPEG, Word, Excel or plain text file.",
      "UNSUPPORTED_FILE",
    );
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))
    throw new AppError(422, "The attachment is not valid base64 data.");
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > maxBytes)
    throw new AppError(
      422,
      `Files must be between 1 byte and ${Math.round(maxBytes / 1048576)} MB.`,
    );
  if (!rule.check(bytes))
    throw new AppError(
      422,
      "The file content does not match its type.",
      "UNSUPPORTED_FILE",
    );
  return { name, type: input.type, bytes };
}
