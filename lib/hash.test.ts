import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { dhash, hammingDistanceHex, sha256 } from "./hash";
import { hammingDistanceHex as guardrailHamming } from "./guardrail";

async function imageFromPixels(pixels: number[], width = 9, height = 8): Promise<Buffer> {
  return sharp(Buffer.from(pixels), { raw: { width, height, channels: 1 } }).png().toBuffer();
}

describe("sha256", () => {
  it("matches a published SHA-256 test vector", () => {
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hashes the original bytes, including empty input", () => {
    expect(sha256(Buffer.alloc(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256(Buffer.from([0, 1]))).not.toBe(sha256(Buffer.from([1, 0])));
  });
});

describe("dhash", () => {
  it("emits 64 zero bits for a uniform image, preserving leading zeros", async () => {
    expect(await dhash(await imageFromPixels(Array(72).fill(128)))).toBe("0000000000000000");
  });
  it("uses left-greater-than-right comparisons", async () => {
    const increasing = Array.from({ length: 72 }, (_, index) => (index % 9) * 28);
    const decreasing = increasing.map((value) => 255 - value);
    expect(await dhash(await imageFromPixels(increasing))).toBe("0000000000000000");
    expect(await dhash(await imageFromPixels(decreasing))).toBe("ffffffffffffffff");
  });
  it("lays out bits row-major from the most significant bit", async () => {
    const pixels = Array(72).fill(0) as number[];
    pixels[0] = 255;
    expect(await dhash(await imageFromPixels(pixels))).toBe("8000000000000000");
  });
  it("handles RGB, alpha, and non-9x8 sizes deterministically", async () => {
    const input = await sharp({ create: { width: 120, height: 90, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } } }).png().toBuffer();
    expect(await dhash(input)).toBe("0000000000000000");
    expect(await dhash(input)).toBe(await dhash(input));
  });
  it("rejects corrupt image data", async () => {
    await expect(dhash(Buffer.from("not an image"))).rejects.toThrow();
  });
});

describe("hammingDistanceHex in isolation", () => {
  it("reuses exactly the helper from guardrail.ts", () => {
    expect(hammingDistanceHex).toBe(guardrailHamming);
  });
  it("returns 0 for equal hashes and 64 for inverted 64-bit hashes", () => {
    expect(hammingDistanceHex("0123456789abcdef", "0123456789abcdef")).toBe(0);
    expect(hammingDistanceHex("0000000000000000", "ffffffffffffffff")).toBe(64);
  });
  it("counts changed bits rather than changed hex digits", () => {
    expect(hammingDistanceHex("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingDistanceHex("8000000000000000", "0000000000000001")).toBe(2);
  });
});
