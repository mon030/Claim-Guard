import { loadDataset } from "../lib/dataset";
import { runCli, writeReport } from "../lib/cli";
const escapeCell = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;").replace(/[\r\n]+/g, " ");
await runCli(async () => {
  const { claims, mapping } = await loadDataset();
  const lines = ["# ClaimGuard photo mapping", "", "Source: the team's manually completed data/mapping.json. Structural validation passed; human visual review establishes correctness.", "", "| Claim ID | Claimant | Narrative | Photo 1 | Photo 2 |", "| --- | --- | --- | --- | --- |"];
  for (const claim of claims) lines.push(`| ${[claim.claimId, claim.claimant, claim.narrative, ...mapping[claim.claimId]!].map(escapeCell).join(" | ")} |`);
  await writeReport("docs/MAPPING.md", `${lines.join("\n")}\n`);
  console.log("Wrote docs/MAPPING.md from the validated mapping.");
});
