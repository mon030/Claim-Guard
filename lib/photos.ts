import sharp from "sharp";
import { sha256, dhash } from "./hash";
import { DatasetError } from "./errors";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export async function fingerprintPhoto(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) throw new DatasetError("A photo must contain between 1 byte and 8 MiB.");
  return { sha256: sha256(buffer), dhash: await dhash(buffer) };
}
export async function thumbnail(buffer: Buffer, size = { width: 480, height: 360 }): Promise<Buffer> {
  return sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" }).rotate()
    .resize(size.width, size.height, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 }).toBuffer();
}
