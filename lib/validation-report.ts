import { guardrailConfig, RULE_VERSION } from "./guardrail.config";
import { hammingDistanceHex } from "./hash";
import type { LookupReport } from "./lookup";

export function buildValidationReport(photos: LookupReport[], generatedAt = new Date()) {
  const hashes = new Map<string, string[]>();
  for (const photo of photos) { const names = hashes.get(photo.sha256) ?? []; names.push(photo.filename); hashes.set(photo.sha256, names); }
  const byteIdenticalGroups = [...hashes.entries()].filter(([, filenames]) => filenames.length > 1).map(([sha256, filenames]) => ({ sha256, filenames }));
  const allPairDistances: { a: string; b: string; distance: number; byteIdentical: boolean }[] = [];
  const histogram = Array.from({ length: 65 }, (_, distance) => ({ distance, pairs: 0 }));
  for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
    const a = photos[i], b = photos[j], distance = hammingDistanceHex(a.dhash, b.dhash);
    histogram[distance].pairs++;
    allPairDistances.push({ a: a.filename, b: b.filename, distance, byteIdentical: a.sha256 === b.sha256 });
  }
  const domainStats = new Map<string, { photos: Set<string>; hashes: Set<string> }>();
  for (const photo of photos) for (const domain of photo.vision?.domains ?? []) {
    const stats = domainStats.get(domain) ?? { photos: new Set<string>(), hashes: new Set<string>() };
    stats.photos.add(photo.filename); stats.hashes.add(photo.sha256); domainStats.set(domain, stats);
  }
  const domains = [...domainStats].map(([domain, stats]) => ({ domain, photoCount: stats.photos.size, uniqueImageCount: stats.hashes.size }))
    .sort((a, b) => b.uniqueImageCount - a.uniqueImageCount || a.domain.localeCompare(b.domain));
  return {
    generatedAt: generatedAt.toISOString(), ruleVersion: RULE_VERSION,
    config: { ...guardrailConfig, STOCK_DOMAIN_ALLOWLIST: [...guardrailConfig.STOCK_DOMAIN_ALLOWLIST] },
    photoCount: photos.length, uniqueByteHashes: hashes.size,
    successfulPhotos: photos.filter((photo) => photo.webCheck.status === "ok").length,
    unavailablePhotos: photos.filter((photo) => photo.webCheck.status !== "ok").length,
    photos, topDomains: domains.slice(0, 20), allDomains: domains, byteIdenticalGroups,
    nearDuplicatePairs: allPairDistances.filter((pair) => !pair.byteIdentical && pair.distance <= guardrailConfig.DHASH_MAX_DISTANCE).sort((a, b) => a.distance - b.distance),
    distanceHistogram: histogram, allPairDistances,
    nonStockMatches: photos.filter((photo) => (photo.vision?.nonStockFullMatchCount ?? 0) > 0).map((photo) => ({ filename: photo.filename, count: photo.vision!.nonStockFullMatchCount })),
  };
}
export type ValidationReport = ReturnType<typeof buildValidationReport>;
export function formatValidationReport(report: ValidationReport): string {
  const lines = [
    "ClaimGuard Vision validation", `Generated: ${report.generatedAt}`,
    `Photos: ${report.photoCount}; distinct SHA-256 hashes: ${report.uniqueByteHashes}; completed: ${report.successfulPhotos}; unavailable: ${report.unavailablePhotos}`,
    `Current placeholder thresholds: DHASH_MAX_DISTANCE=${report.config.DHASH_MAX_DISTANCE}, WEB_FULL_MATCH_THRESHOLD=${report.config.WEB_FULL_MATCH_THRESHOLD}. This report does not change thresholds.`,
    "Counts are returned Vision matches, not an exhaustive web census. Stock classification uses full-match image URL hosts.",
    "No claim-to-photo mappings are inferred. UNAVAILABLE is not a zero-match result.", "", "PER-PHOTO LOOKUPS", "Filename | source | full | partial | similar | pages | stock-full | nonstock-full",
  ];
  for (const photo of report.photos) {
    const v = photo.vision;
    lines.push(v ? `${photo.filename} | ${photo.webCheck.source} | ${v.fullMatchCount} | ${v.partialMatchCount} | ${v.similarCount} | ${v.pageCount} | ${v.stockDomainMatchCount} | ${v.nonStockFullMatchCount}` : `${photo.filename} | UNAVAILABLE | - | - | - | - | - | -`);
    if (photo.visionError) lines.push(`  Error: ${photo.visionError}`);
    if (v?.domains.length) lines.push(`  Domains: ${v.domains.join(", ")}`);
    if (photo.checkedAt) lines.push(`  Evidence checked: ${photo.checkedAt}`);
    for (const warning of photo.warnings) lines.push(`  Warning: ${warning}`);
  }
  lines.push("", "TOP DOMAINS (ranked by distinct byte hashes, with photo counts)");
  lines.push(...report.topDomains.map((row) => `${row.domain}: ${row.uniqueImageCount} unique images, ${row.photoCount} photo files`));
  if (!report.topDomains.length) lines.push("No domains available from completed lookups.");
  lines.push("", "BYTE-IDENTICAL GROUPS (SHA-256)");
  lines.push(...report.byteIdenticalGroups.map((group) => `${group.filenames.join(", ")} | ${group.sha256}`));
  if (!report.byteIdenticalGroups.length) lines.push("None.");
  lines.push("", `NEAR-DUPLICATE CANDIDATES (different bytes; dHash distance <= ${report.config.DHASH_MAX_DISTANCE})`);
  lines.push(...report.nearDuplicatePairs.map((pair) => `${pair.a} / ${pair.b}: distance ${pair.distance}`));
  if (!report.nearDuplicatePairs.length) lines.push("None at the current threshold.");
  lines.push("", `DISTANCE HISTOGRAM (all ${report.allPairDistances.length} unordered file pairs, including byte-identical pairs)`);
  lines.push(...report.distanceHistogram.map((bin) => `${String(bin.distance).padStart(2)}: ${bin.pairs}`));
  lines.push("", "PHOTOS WITH NON-STOCK FULL MATCHES");
  lines.push(...report.nonStockMatches.map((row) => `${row.filename}: ${row.count}`));
  if (!report.nonStockMatches.length) lines.push("None in completed lookups; unavailable lookups are not evidence of absence.");
  lines.push("", "Use the JSON allPairDistances to examine any proposed dHash threshold. Visually review candidates before changing the team's config.");
  return `${lines.join("\n")}\n`;
}
