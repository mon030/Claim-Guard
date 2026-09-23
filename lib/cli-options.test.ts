import { expect, it } from "vitest";
import { isDryRun } from "./cli-options";
it("preserves dry-run intent whether the flag is forwarded or consumed by npm", () => {
  expect(isDryRun(["--dry-run"], {})).toBe(true);
  expect(isDryRun([], { npm_config_dry_run: "true" })).toBe(true);
  expect(isDryRun([], { npm_config_dry_run: "1" })).toBe(true);
  expect(isDryRun([], {})).toBe(false);
  expect(isDryRun([], { npm_config_dry_run: "false" })).toBe(false);
});
