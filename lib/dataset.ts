import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { DatasetError } from "./errors";
export { DatasetError } from "./errors";

export const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PHOTO_DIR = path.join(PROJECT_ROOT, "data", "photos");
export const REFERENCE_FILENAMES = Array.from({ length: 36 }, (_, i) => `IMG-${String(i + 1).padStart(3, "0")}.jpg`);
const seedClaimSchema = z.object({
  claimId: z.string().min(1), claimant: z.string().min(1), customerEmail: z.email(),
  emailSubject: z.string(), emailBody: z.string(), date: z.iso.date(), location: z.string(),
  category: z.string(), amount: z.number().nonnegative(), narrative: z.string().min(1),
});
export type SeedClaim = z.infer<typeof seedClaimSchema>;
export type PhotoMapping = Record<string, [string, string] | null>;

export async function readJson(relative: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path.join(PROJECT_ROOT, relative), "utf8")); }
  catch { throw new DatasetError(`Cannot read valid JSON from ${relative}.`); }
}
export async function readClaims(): Promise<SeedClaim[]> {
  const parsed = z.array(seedClaimSchema).length(18).safeParse(await readJson("data/claims.json"));
  if (!parsed.success) throw new DatasetError("data/claims.json must contain the 18 supplied claims with valid fields.");
  if (new Set(parsed.data.map((claim) => claim.claimId)).size !== parsed.data.length) throw new DatasetError("Duplicate claimId in data/claims.json.");
  return parsed.data;
}
export async function listReferencePhotos(): Promise<string[]> {
  let entries;
  try { entries = await readdir(PHOTO_DIR, { withFileTypes: true }); }
  catch { throw new DatasetError("data/photos/ is missing. Put IMG-001.jpg through IMG-036.jpg there, outside public/."); }
  const names = entries.filter((entry) => entry.name.toLowerCase() !== "readme.txt");
  const problems = [
    ...REFERENCE_FILENAMES.filter((name) => !names.some((entry) => entry.name === name && entry.isFile())).map((name) => `Missing reference photo: ${name}`),
    ...names.filter((entry) => !REFERENCE_FILENAMES.includes(entry.name) || !entry.isFile()).map((entry) => `Unexpected file, link, or directory: ${entry.name}`),
  ];
  if (problems.length) throw new DatasetError(problems.join("\n"));
  return [...REFERENCE_FILENAMES];
}

export function validateMapping(claims: readonly Pick<SeedClaim, "claimId">[], input: unknown, filenames: readonly string[], allowUnmapped = false) {
  const errors: string[] = [], warnings: string[] = [];
  const mapping: PhotoMapping = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["data/mapping.json must be an object keyed by claimId."], warnings, mapping };
  const values = input as Record<string, unknown>;
  const ids = new Set(claims.map((claim) => claim.claimId));
  const used = new Map<string, string[]>();
  for (const id of Object.keys(values)) if (!ids.has(id)) errors.push(`Unknown claimId in mapping: ${id}`);
  for (const { claimId } of claims) {
    if (!Object.hasOwn(values, claimId)) { errors.push(`Missing mapping entry for ${claimId}.`); continue; }
    const value = values[claimId];
    if (value === null) {
      mapping[claimId] = null;
      (allowUnmapped ? warnings : errors).push(`${claimId}: mapping is null; exactly 2 distinct photo filenames are required.`);
      continue;
    }
    if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === "string")) {
      errors.push(`${claimId}: expected an array of exactly 2 filenames${allowUnmapped ? " or null" : ""}.`); continue;
    }
    const [first, second] = value as [string, string];
    if (first === second) errors.push(`${claimId}: the same filename appears twice (${first}).`);
    for (const filename of value as string[]) {
      if (!filenames.includes(filename)) errors.push(`${claimId}: photo does not exist in data/photos/: ${filename}`);
      const owners = used.get(filename) ?? []; owners.push(claimId); used.set(filename, owners);
    }
    mapping[claimId] = [first, second];
  }
  for (const [filename, owners] of used) if (owners.length > 1) errors.push(`${filename}: used ${owners.length} times (${owners.join(", ")}); each photo must be used exactly once.`);
  if (!allowUnmapped || warnings.length === 0) {
    for (const filename of filenames) if (!used.has(filename)) errors.push(`${filename}: not assigned to any claim.`);
  }
  return { errors, warnings, mapping };
}
export async function loadDataset(allowUnmapped = false) {
  const [claims, filenames, rawMapping] = await Promise.all([readClaims(), listReferencePhotos(), readJson("data/mapping.json")]);
  const checked = validateMapping(claims, rawMapping, filenames, allowUnmapped);
  if (checked.errors.length) throw new DatasetError(checked.errors.join("\n"));
  return { claims, filenames, ...checked };
}
