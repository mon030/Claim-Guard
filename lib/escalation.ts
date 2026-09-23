import { getOptionalEnv } from "./env";
import type { ClaimEvidence, GuardrailResult } from "./guardrail";
import { singleLineSummary } from "./google-form";

export type EscalationStatus = "not_required" | "not_configured" | "sent" | "failed";
/** This is an adjuster notification, never a form submission. Config rejects Forms hosts. */
export async function notifyEscalation(claim: ClaimEvidence, result: GuardrailResult): Promise<EscalationStatus> {
  if (result.decision !== "Escalate") return "not_required";
  const url = getOptionalEnv().ESCALATION_WEBHOOK_URL;
  if (!url) return "not_configured";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const reasons = result.reasons.map((reason) => singleLineSummary(reason, 300)).slice(0, 8);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId: claim.claimId, claimant: claim.claimant, amount: claim.amount, reasons,
        text: singleLineSummary(`Claim ${claim.claimId} (${claim.claimant}), amount ${claim.amount}: ${reasons.join(" ")}`, 1_500) }),
      redirect: "error", cache: "no-store", signal: controller.signal });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Webhook rejected notification");
    return "sent";
  } catch {
    console.warn("Escalation notification failed; the decision and human-only form workflow are unchanged.");
    return "failed";
  } finally { clearTimeout(timer); }
}
