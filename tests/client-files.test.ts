import { File } from "node:buffer";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectImages, extractBoundedZip, readDescription } from "../lib/client/files";
import { fitDimensions, preparePhoto } from "../lib/client/images";
import { runPool } from "../lib/client/api";

beforeEach(() => vi.stubGlobal("File", File));
const image = () => sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
describe("bounded ZIP import", () => {
  it("keeps images in subdirectories and ignores README, directories, and platform junk", async () => {
    const zip = zipSync({ "folder/": new Uint8Array(), "folder/one.jpg": strToU8("synthetic"), "two.PNG": strToU8("synthetic"), "README.txt": strToU8("ignore"), "__MACOSX/photo.jpg": strToU8("ignore"), ".DS_Store": strToU8("ignore") });
    expect((await extractBoundedZip(zip)).map((file) => file.name)).toEqual(["folder/one.jpg", "two.PNG"]);
  });
  it("returns a 36-image archive intact so a human chooses which photos to remove", async () => {
    const zip = zipSync(Object.fromEntries(Array.from({ length: 36 }, (_, index) => [`IMG-${index}.jpg`, strToU8("test")])));
    expect(await extractBoundedZip(zip)).toHaveLength(36);
  });
  it("rejects too many entries, nested archives and unsafe paths", async () => {
    const tooMany = zipSync(Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`${index}.jpg`, strToU8("test")])));
    await expect(extractBoundedZip(tooMany)).rejects.toThrow("50 entries");
    await expect(extractBoundedZip(zipSync({ "nested.zip": strToU8("test") }))).rejects.toThrow("Nested");
    await expect(extractBoundedZip(zipSync({ "../photo.jpg": strToU8("test") }))).rejects.toThrow("unsafe");
  });
  it("rejects a declared compression bomb before inflating", async () => {
    const zip = zipSync({ "large.jpg": strToU8("test") });
    const view = new DataView(zip.buffer);
    for (let index = 0; index < zip.length - 46; index++) if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 24, 30_000_001, true); break; }
    await expect(extractBoundedZip(zip)).rejects.toThrow("30 MB");
  });
  it("checks real output against dishonest directory sizes", async () => {
    const zip = zipSync({ "lying.jpg": new Uint8Array(200_000) });
    const view = new DataView(zip.buffer);
    for (let index = 0; index < zip.length - 46; index++) if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 24, 1, true); break; }
    await expect(extractBoundedZip(zip)).rejects.toThrow(/declared size|could not be decompressed/);
  });
  it("rejects truncated ZIPs and empty selections", async () => {
    const zip = zipSync({ "a.jpg": strToU8("test") });
    await expect(extractBoundedZip(zip.slice(0, -10))).rejects.toThrow();
    await expect(collectImages([new File(["ignore"], "README.txt") as globalThis.File])).rejects.toThrow("No JPG");
  });
  it("enforces the combined byte limit before reading later archives", async () => {
    const first = new File([new Uint8Array(20_000_000)], "one.jpg") as globalThis.File;
    const second = new File([new Uint8Array(11_000_000)], "two.jpg") as globalThis.File;
    const later = new File(["not read"], "later.zip") as globalThis.File;
    const read = vi.spyOn(later, "arrayBuffer");
    await expect(collectImages([first, second, later])).rejects.toThrow("30 MB");
    expect(read).not.toHaveBeenCalled();
  });
});
describe("image preparation", () => {
  it("leaves original bytes under 3 MB untouched and hashes exactly those bytes", async () => {
    const original = new File([new Uint8Array(await image())], "photo.jpg", { type: "image/jpeg" }) as globalThis.File;
    const bitmap = vi.fn(); vi.stubGlobal("createImageBitmap", bitmap);
    const prepared = await preparePhoto(original);
    expect(prepared.file).toBe(original); expect(prepared.resized).toBe(false); expect(bitmap).not.toHaveBeenCalled();
    expect(prepared.sha256).toMatch(/^[a-f\d]{64}$/); expect(await prepared.file.arrayBuffer()).toEqual(await original.arrayBuffer());
  });
  it("bounds large-image dimensions while preserving aspect ratio", () => {
    expect(fitDimensions(4000, 2000)).toEqual({ width: 1600, height: 800 });
    expect(fitDimensions(1000, 3000)).toEqual({ width: 533, height: 1600 });
    expect(fitDimensions(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it("rejects a mislabeled SVG before attempting client rasterization", async () => {
    await expect(preparePhoto(new File(["<svg/>"], "fake.jpg") as globalThis.File)).rejects.toThrow("image bytes");
  });
  it("resizes files over 3MB and marks the new JPEG without hashing the original", async () => {
    const content = new Uint8Array(3_000_001); content.set([255, 216, 255]);
    const close = vi.fn(), drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), drawImage }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([255, 216, 255, 1])], { type: "image/jpeg" })) }) });
    const prepared = await preparePhoto(new File([content], "big.png") as globalThis.File);
    expect(prepared.resized).toBe(true); expect(prepared.file.name).toBe("big.jpg"); expect(prepared.file.size).toBe(4); expect(close).toHaveBeenCalled(); expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
  });
});
describe("description input and bounded concurrency", () => {
  it("returns plain imported text without rendering HTML", async () => {
    const text = "<script>untrusted text</script>\nClaim narrative";
    expect(await readDescription(new File([text], "claim.md") as globalThis.File)).toBe(text);
    await expect(readDescription(new File(["x".repeat(10001)], "claim.txt") as globalThis.File)).rejects.toThrow("10,000");
  });
  it("runs at most two lookups and waits for all started work even when one fails", async () => {
    let active = 0, peak = 0, finished = 0;
    const result = await runPool([0, 1, 2, 3, 4, 5], async (value) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2)); active--; finished++;
      if (value === 1) throw new Error("synthetic"); return value;
    });
    expect(peak).toBe(2); expect(finished).toBe(6); expect(result[1].status).toBe("rejected"); expect(result[5]).toEqual({ status: "fulfilled", value: 5 });
  });
});
