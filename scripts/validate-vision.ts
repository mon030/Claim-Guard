import { readFile } from "node:fs/promises";
import path from "node:path";
import { listReferencePhotos, PHOTO_DIR } from "../lib/dataset";
import { runCli, safeError, writeReport } from "../lib/cli";
import { ensureIndexes, getDb } from "../lib/mongodb";
import { lookupPhoto, type LookupReport } from "../lib/lookup";
import { fingerprintPhoto } from "../lib/photos";
import { toWebCheck } from "../lib/vision";
import { buildValidationReport, formatValidationReport } from "../lib/validation-report";

await runCli(async () => {
  const filenames = await listReferencePhotos();
  let setupFailure: string | null = null;
  try { await ensureIndexes(await getDb()); } catch (error) { setupFailure = safeError(error); }
  const results: LookupReport[] = [];
  for (const filename of filenames) {
    const bytes = await readFile(path.join(PHOTO_DIR, filename));
    let result: LookupReport;
    try {
      if (setupFailure) throw new Error("Database setup unavailable");
      result = await lookupPhoto(bytes, { filename, referenceFilename: filename });
    } catch (error) {
      result = { filename, ...await fingerprintPhoto(bytes), vision: null, webCheck: toWebCheck(null), checkedAt: null,
        visionError: setupFailure ?? safeError(error), warnings: [], unavailableReason: "vision_error", matchedClaimants: {}, referenceMatches: [], crossClaimMatches: [], referenceCoverage: { total: 0, unmapped: 0, available: false } };
    }
    results.push(result);
    console.log(`${filename}: ${result.vision ? `${result.webCheck.source}, full=${result.vision.fullMatchCount}, non-stock full=${result.vision.nonStockFullMatchCount}` : `UNAVAILABLE — ${result.visionError}`}`);
    // Save after every photo so interruption leaves an honest partial report.
    const report = buildValidationReport(results);
    await writeReport("docs/vision-validation.json", `${JSON.stringify(report, null, 2)}\n`);
    await writeReport("docs/vision-validation.txt", formatValidationReport(report));
  }
  const report = buildValidationReport(results);
  console.log(`\n${formatValidationReport(report)}`);
  console.log("Saved docs/vision-validation.txt and docs/vision-validation.json.");
  if (report.unavailablePhotos) process.exitCode = 1;
});
