import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatasetError, PROJECT_ROOT } from "./dataset";
import { closeMongoClient } from "./mongodb";
import { safeError } from "./errors";
export { safeError } from "./errors";
export async function runCli(work: () => Promise<void>): Promise<void> {
  try { await work(); }
  catch (error) { console.error(safeError(error)); process.exitCode = 1; }
  finally { await closeMongoClient().catch(() => undefined); }
}
export async function writeReport(relative: string, text: string): Promise<void> {
  const target = path.resolve(PROJECT_ROOT, relative);
  if (!target.startsWith(PROJECT_ROOT)) throw new DatasetError("Report output must stay inside the project.");
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, target);
}
