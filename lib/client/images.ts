export interface PreparedPhoto { file: File; resized: boolean; sha256: string; }
export const RESIZE_THRESHOLD = 3_000_000;
export function fitDimensions(width: number, height: number) {
  const scale = Math.min(1, 1600 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function preparePhoto(original: File): Promise<PreparedPhoto> {
  const signature = new Uint8Array(await original.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte);
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  const text = new TextDecoder().decode(signature);
  if (!png && !jpeg && !(text.startsWith("RIFF") && text.slice(8) === "WEBP")) throw new Error("Only JPEG, PNG, and WebP image bytes are accepted.");
  let file = original;
  const resized = original.size > RESIZE_THRESHOLD;
  if (resized) {
    const bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    try {
      if (bitmap.width * bitmap.height > 40_000_000) throw new Error("Image exceeds 40 megapixels.");
      const canvas = document.createElement("canvas"), dimensions = fitDimensions(bitmap.width, bitmap.height);
      canvas.width = dimensions.width; canvas.height = dimensions.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot resize the image.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image resizing failed.")), "image/jpeg", 0.88));
      file = new File([blob], original.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally { bitmap.close(); }
  }
  if (!file.size || file.size > 4_000_000) throw new Error("Image is empty or still exceeds 4 MB after resizing.");
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return { file, resized, sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}
