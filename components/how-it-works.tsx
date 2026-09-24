import { guardrailConfig as rules } from "../lib/guardrail.config";
export function HowItWorks() {
  return <details className="collapse collapse-arrow border border-base-300 bg-base-100 no-print">
    <summary className="collapse-title font-semibold">How ClaimGuard decides</summary>
    <div className="collapse-content space-y-3 text-sm">
      <p>We compare each photo with photos belonging to other claims. An exact duplicate has identical file bytes. A visually similar photo has a perceptual fingerprint distance of {rules.DHASH_MAX_DISTANCE} or less out of 64. Similarity is a review signal, not proof of fraud.</p>
      <p>If all claim photos match other claims, we escalate. If only some match, we {rules.PARTIAL_MATCH_ACTION === "escalate" ? "also escalate for human review" : "add a note for the adjuster"}.</p>
      <p>Google Web Detection looks for full matches, partial matches and similar images online. At least {rules.WEB_FULL_MATCH_THRESHOLD} full matches outside known stock-photo sites trigger human review. Full matches hosted on {rules.STOCK_DOMAIN_ALLOWLIST.join(", ")} (including their subdomains) are excluded from that threshold because those sites may be the original source. Stock matches do not guarantee approval.</p>
      <p>{rules.ON_WEB_CHECK_UNAVAILABLE === "escalate" ? "When a web check cannot be completed, the claim escalates to a human; an unavailable check never counts as approval." : "The current configuration allows an unavailable web check; ask the team to restore fail-closed review before relying on this demo."} Zero reported matches mean the lookup succeeded without finding a match—not that originality is proven.</p>
      <p>A similar narrative alone never escalates a claim. Similarity of {Math.round(rules.NARRATIVE_SIMILARITY_NOTE_THRESHOLD * 100)}% or more adds an adjuster note. Another claim by the same person within {rules.CONTEXT_WINDOW_DAYS} days also adds context, not an automatic escalation.</p>
      <p>A human must sign in and submit the pre-filled Google Form. ClaimGuard cannot do that step.</p>
    </div>
  </details>;
}
