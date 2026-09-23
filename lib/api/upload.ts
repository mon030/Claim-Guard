import sharp from "sharp";
import { z } from "zod";
import { ApiError, claimIdSchema, objectIdSchema, readBody, readJson } from "./http";

export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_MULTIPART_BYTES = 4_400_000;
const seedSchema = z.strictObject({ photoId: objectIdSchema, forceLive: z.boolean().default(false) });
const uploadSchema = z.strictObject({
  claimId: claimIdSchema,
  slot: z.enum(["1", "2", "3", "4", "5", "6"]).transform(Number),
  resized: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  forceLive: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});
export type LookupInput =
  | { kind: "seed"; photoId: string; forceLive: boolean }
  | { kind: "upload"; claimId: string; slot: number; resized: boolean; forceLive: boolean; filename: string; bytes: Buffer };

export async function readLookupInput(request: Request): Promise<LookupInput> {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type === "application/json") return { kind: "seed", ...seedSchema.parse(await readJson(request)) };
  if (type !== "multipart/form-data") throw new ApiError(415, "content_type", "Send one multipart image or application/json with a seeded photoId.");
  const body = await readBody(request, MAX_MULTIPART_BYTES);
  let form: FormData;
  try { form = await new Response(new Uint8Array(body), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new ApiError(400, "invalid_multipart", "Invalid multipart image request."); }
  const allowed = new Set(["file", "claimId", "slot", "forceLive", "resized"]);
  for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) throw new ApiError(400, "single_image_required", "Send exactly one image and one value per field. ZIP and batch requests are not supported.");
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, "single_image_required", "Exactly one image file is required.");
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "image_too_large", "Each image must contain 1 to 4,000,000 bytes.");
  const fields = uploadSchema.parse({ claimId: form.get("claimId"), slot: form.get("slot"), forceLive: form.get("forceLive") ?? undefined, resized: form.get("resized") ?? undefined });
  const filename = file.name.split(/[\\/]/).pop()?.replace(/[\p{C}]/gu, "").trim().slice(0, 160) || "uploaded-image";
  return { kind: "upload", ...fields, filename, bytes: Buffer.from(await file.arrayBuffer()) };
}

/** The claimed MIME type and filename are deliberately ignored. Decode again when hashing/thumbnailing. */
export async function validateImage(bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "image_too_large", "Each image must contain 1 to 4,000,000 bytes.");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw new Error("unsupported");
    return `image/${metadata.format}`;
  } catch { throw new ApiError(415, "invalid_image", "Only valid, single-frame JPEG, PNG, and WebP images are supported (maximum 40 megapixels)."); }
}
