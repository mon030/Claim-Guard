export const MAX_BATCH_BYTES = 30_000_000;
export const MAX_ARCHIVE_ENTRIES = 50;
export const IMAGE_NAME = /\.(jpe?g|png|webp)$/i;
const ARCHIVE_NAME = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i;
export interface ExtractedFile { name: string; bytes: Uint8Array; }

/** Check central-directory sizes before allocation, then verify actual streaming output too. */
export async function extractBoundedZip(bytes: Uint8Array, imagesOnly = true): Promise<ExtractedFile[]> {
  if (bytes.length > MAX_BATCH_BYTES || bytes.length < 22) throw new Error("ZIP must be valid and no larger than 30 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end--) if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  if (end < 0 || end < bytes.length - 65_557) throw new Error("ZIP directory is missing or invalid.");
  const entries = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== entries || entries > MAX_ARCHIVE_ENTRIES || offset + size !== end) throw new Error("ZIP must contain at most 50 entries and cannot be split or ZIP64.");
  const expected = new Map<string, number>();
  let cursor = offset, declared = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP directory.");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const length = view.getUint32(cursor + 24, true), nameLength = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if (next > end || flags & 1 || ![0, 8].includes(method)) throw new Error("Encrypted or unsupported ZIP entry.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || expected.has(name)) throw new Error("ZIP contains an unsafe or repeated filename.");
    if (ARCHIVE_NAME.test(name)) throw new Error("Nested archives are not accepted.");
    declared += length;
    if (declared > MAX_BATCH_BYTES) throw new Error("ZIP expands beyond the 30 MB limit.");
    expected.set(name, length); cursor = next;
  }
  if (cursor !== end) throw new Error("Invalid ZIP directory size.");
  const { Unzip, UnzipInflate } = await import("fflate");
  const output: ExtractedFile[] = [], seen = new Set<string>();
  let actual = 0, completed = 0;
  const unzip = new Unzip((file) => {
    if (!expected.has(file.name) || seen.has(file.name)) throw new Error("ZIP headers disagree.");
    seen.add(file.name);
    const junk = file.name.split("/").some((part) => part === "__MACOSX" || part.startsWith("."));
    const keep = !file.name.endsWith("/") && !junk && (!imagesOnly || IMAGE_NAME.test(file.name));
    let fileSize = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error("ZIP data could not be decompressed.");
      actual += chunk.length; fileSize += chunk.length;
      if (actual > MAX_BATCH_BYTES || fileSize > expected.get(file.name)!) { file.terminate(); throw new Error("ZIP exceeds its declared size or the 30 MB limit."); }
      if (keep) chunks.push(chunk);
      if (final) {
        if (fileSize !== expected.get(file.name)) throw new Error("Truncated ZIP entry.");
        completed++;
        if (keep) {
          const result = new Uint8Array(fileSize); let position = 0;
          for (const piece of chunks) { result.set(piece, position); position += piece.length; }
          output.push({ name: file.name, bytes: result });
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Tiny input chunks bound expansion before the actual-size check can stop a dishonest stream.
  for (let position = 0; position < bytes.length; position += 1_024) {
    unzip.push(bytes.subarray(position, position + 1_024), position + 1_024 >= bytes.length);
    if (position % 65_536 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (seen.size !== entries || completed !== entries) throw new Error("ZIP is incomplete.");
  return output;
}

export async function collectImages(inputs: readonly File[]): Promise<File[]> {
  const result: File[] = []; let total = 0;
  function add(file: File) {
    total += file.size;
    if (total > MAX_BATCH_BYTES) throw new Error("The combined images exceed 30 MB uncompressed.");
    if (result.length >= MAX_ARCHIVE_ENTRIES) throw new Error("The combined selection contains more than 50 images.");
    result.push(file);
  }
  if (inputs.length > MAX_ARCHIVE_ENTRIES) throw new Error("Select at most 50 files at a time.");
  for (const file of inputs) {
    if (file.size > MAX_BATCH_BYTES) throw new Error(`${file.name}: file exceeds 30 MB.`);
    if (/\.zip$/i.test(file.name)) {
      const images = await extractBoundedZip(new Uint8Array(await file.arrayBuffer()));
      for (const image of images) add(new File([new Uint8Array(image.bytes)], image.name.split("/").pop()!, { type: mimeFor(image.name) }));
    } else if (IMAGE_NAME.test(file.name)) add(file);
  }
  if (!result.length) throw new Error("No JPG, PNG, or WebP images were found. Other files are ignored.");
  return result;
}
function mimeFor(name: string): string { return /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg"; }

export async function readDescription(file: File): Promise<string> {
  if (file.size > 3_000_000) throw new Error("Description files must be no larger than 3 MB.");
  let text: string;
  if (/\.(txt|md)$/i.test(file.name)) text = await file.text();
  else if (/\.docx$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    await extractBoundedZip(new Uint8Array(buffer), false);
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  } else throw new Error("Choose a .txt, .md, or .docx description file.");
  if (!text.trim()) throw new Error("The file contains no readable description.");
  if (text.length > 10_000) throw new Error("Description exceeds 10,000 characters. Shorten it before importing.");
  return text;
}
