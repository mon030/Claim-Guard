import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("claim picker scroll layout", () => {
  it("overrides daisyUI column wrapping so bounded options scroll vertically", () => {
    const source = readFileSync(new URL("../components/claim-picker.tsx", import.meta.url), "utf8");
    const menu = source.match(/<ul\s[^>]*className=\{`([^`]+)`\}/)?.[1];
    expect(menu).toBeDefined();
    expect(menu).toContain("menu-vertical flex-nowrap");
    expect(menu).toContain("max-h-72 overflow-y-auto overflow-x-hidden");
    expect(menu).toContain("overscroll-contain");
  });
});
