import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { DatasetError, PHOTO_DIR, REFERENCE_FILENAMES } from "../lib/dataset";
import { runCli, writeReport } from "../lib/cli";
import { ensureIndexes, getDb, getCollections } from "../lib/mongodb";
import { lookupPhoto } from "../lib/lookup";
import { sha256 } from "../lib/hash";

await runCli(async () => {
  const [input, ...extra] = process.argv.slice(2);
  if (!input || extra.length) throw new DatasetError("Usage: npm run lookup -- ./photo.jpg");
  const resolved = await realpath(path.resolve(input));
  const filename = path.basename(resolved), bytes = await readFile(resolved);
  await ensureIndexes(await getDb());
  const isReference = path.dirname(resolved).toLowerCase() === (await realpath(PHOTO_DIR)).toLowerCase() && REFERENCE_FILENAMES.includes(filename);
  let claimId: string | undefined;
  if (isReference) {
    const { photos } = await getCollections();
    claimId = (await photos.findOne({ origin: "seed", filename, sha256: sha256(bytes) }))?.claimId ?? undefined;
  }
  const report = await lookupPhoto(bytes, { filename, claimId, referenceFilename: isReference ? filename : undefined });
  const evidence = { generatedAt: new Date().toISOString(), claimId: claimId ?? null,
    note: claimId ? "Cross-claim matches exclude this claim." : "Claim association is unknown. Matches are reference-photo matches; fill mappings and rerun seed to establish claim attribution.", ...report };
  const text = JSON.stringify(evidence, null, 2);
  console.log(text);
  await writeReport("tmp/lookup-report.json", `${text}\n`);
  console.log("Saved tmp/lookup-report.json. This is lookup evidence, not a claim decision or form submission.");
  if (report.webCheck.status !== "ok") process.exitCode = 1;
});
