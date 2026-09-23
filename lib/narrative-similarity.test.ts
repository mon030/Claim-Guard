import { describe, expect, it } from "vitest";
import { narrativeSimilarity, tokenizeNarrative } from "./narrative-similarity";

describe("deterministic narrative similarity", () => {
  it("returns one for equivalent tokens despite case, punctuation, or repetition", () => {
    expect(narrativeSimilarity("A REAR-end crash, crash!", "rear end crash")).toBe(1);
  });
  it("calculates set intersection over union", () => {
    expect(narrativeSimilarity("car door dent", "car bumper dent")).toBe(0.5);
  });
  it("returns zero for empty or stopword-only inputs", () => {
    expect(narrativeSimilarity("", "")).toBe(0);
    expect(narrativeSimilarity("the and a", "the a")).toBe(0);
    expect(narrativeSimilarity("", "collision")).toBe(0);
  });
  it("returns zero for unrelated tokens", () => {
    expect(narrativeSimilarity("hail roof", "door collision")).toBe(0);
  });
  it("preserves negation, dates, and Unicode words", () => {
    expect(tokenizeNarrative("NO damage 2026 café")).toEqual(new Set(["no", "damage", "2026", "café"]));
    expect(narrativeSimilarity("ＣＡＲ damage", "car damage")).toBe(1);
  });
  it("is symmetric, deterministic, and bounded", () => {
    const examples = ["", "car damage", "no car damage", "roof hail", "car car"];
    for (const a of examples) for (const b of examples) {
      const score = narrativeSimilarity(a, b);
      expect(score).toBe(narrativeSimilarity(b, a));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
