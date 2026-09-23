import { createHash } from "node:crypto";
import sharp from "sharp";
import { hammingDistanceHex } from "./guardrail";

export { hammingDistanceHex };

/** Exact hash of the original bytes; do not resize before calling this. */
export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * 64-bit horizontal dHash: row-major, most-significant bit first.
 * A bit is 1 when the left pixel is brighter than its right neighbor.
 * Normalize EXIF orientation, flatten transparency on white, grayscale,
 * and stretch the whole image to 9x8 (no crop). Pinning sharp fixes the kernel.
 */
export async function dhash(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 9 || info.height !== 8 || info.channels !== 1) {
    throw new Error("dHash requires a 9x8 single-channel image.");
  }
  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const offset = row * 9 + column;
      hash = (hash << 1n) | (data[offset] > data[offset + 1] ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}
