import { buildPrefillUrl } from "../lib/google-form";
import { runCli } from "../lib/cli";
await runCli(async () => {
  console.log("Manual form wiring test — sample fields only, not a real lookup or decision. The human must sign in and submit.");
  console.log(buildPrefillUrl({ claimId: "TEST-NOT-A-CLAIM", claimant: "Manual form test",
    lookup: "TEST ONLY: no photo lookup was performed. Check that all four fields populate and the submitter email is not prefilled.", decision: "Escalate" }));
});
