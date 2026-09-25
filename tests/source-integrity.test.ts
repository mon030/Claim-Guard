import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import claims from "../data/claims.json";
import mapping from "../data/mapping.json";
import { REFERENCE_FILENAMES, validateMapping } from "../lib/dataset";

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const file = (path: string) => readFileSync(new URL(path, import.meta.url));

describe("team-supplied sources", () => {
  it("preserves the config, all nine tests, and claim data byte for byte", () => {
    expect(digest(file("../lib/guardrail.config.ts"))).toBe("0946cc6e725ec57af32c7d0438224ac4251474f0c97127b47c5d8e8db1acccd5");
    expect(digest(file("../lib/guardrail.test.ts"))).toBe("e71543fbb3034bfe5885daad7c6e01c1ea16d802b819a62ab667da0c67d1c4d5");
    expect(digest(file("../data/claims.json"))).toBe("d2d22a668b74f843ead4deee672d5e6909d36c99815856050657eeb5fce5042c");
  });
  it("changes only the two explicitly authorized lines in guardrail.ts", () => {
    const current = file("../lib/guardrail.ts").toString("utf8");
    expect(current.match(/export function hammingDistanceHex/g)).toHaveLength(1);
    expect(current).toContain("p.webCheck.fullMatchCount > 0 && p.webCheck.nonStockFullMatchCount === 0");
    const restored = current
      .replace("export function hammingDistanceHex", "function hammingDistanceHex")
      .replace("p.webCheck.fullMatchCount > 0 && p.webCheck.nonStockFullMatchCount === 0", "p.webCheck.fullMatchCount > 0");
    expect(digest(restored)).toBe("d7aef34b394d7ec4758a938c982f69d5081ef35d79c59f49b1c582770a5a0132");
  });
  it("accepts only a structurally valid manual mapping or explicit null entries", () => {
    expect(claims).toHaveLength(18);
    expect(new Set(claims.map((claim) => claim.claimId)).size).toBe(18);
    expect(Object.keys(mapping).sort()).toEqual(claims.map((claim) => claim.claimId).sort());
    expect(validateMapping(claims, mapping, REFERENCE_FILENAMES, true).errors).toEqual([]);
  });
});
