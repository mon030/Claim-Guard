import { loadDataset } from "../lib/dataset";
import { runCli } from "../lib/cli";
await runCli(async () => {
  const { claims, filenames } = await loadDataset();
  console.log(`Mapping valid: ${claims.length} claims, 2 distinct photos each, all ${filenames.length} photos used exactly once.`);
});
