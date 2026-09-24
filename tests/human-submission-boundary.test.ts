import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

const excluded = new Set(["node_modules", ".git", ".next", "tmp", "coverage", "dist", "out", ".agents", ".codex"]);
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => !excluded.has(entry.name)).map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(filename);
    return entry.isFile() && /\.(?:[cm]?[jt]sx?|html)$/i.test(entry.name) ? [filename] : [];
  }));
  return nested.flat();
}
it("keeps the Google Forms submission endpoint out of every source file, including tests", async () => {
  // Assemble it so this scanner does not itself introduce the prohibited endpoint.
  const prohibited = ["form", "Response"].join("");
  const violations: string[] = [];
  const files = await sources(process.cwd());
  expect(files.some((filename) => filename.endsWith(path.join("app", "api", "decide", "route.ts")))).toBe(true);
  for (const filename of files) if ((await readFile(filename, "utf8")).includes(prohibited)) violations.push(path.relative(process.cwd(), filename));
  expect(violations).toEqual([]);
});
