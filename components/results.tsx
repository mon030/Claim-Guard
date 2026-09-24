"use client";
import { useEffect, useRef } from "react";
import type { DecideResponse } from "../lib/api/contracts";
import type { PhotoItem } from "../lib/client/use-claim-guard";
import { EvidenceCard } from "./evidence-card";
const notificationLabels = { not_required: "Not needed for this decision.", not_configured: "No adjuster-notification webhook is configured. Share the findings with an adjuster manually.", sent: "Adjuster notification sent.", failed: "Notification failed. The decision is saved; contact an adjuster manually." };
export function Results({ decision, photos, code, busy, llmConfigured, explanation, rerun, copy, explain, print, startOver, claimLabel }: {
  decision: DecideResponse | null; photos: PhotoItem[]; code: string; busy: boolean; llmConfigured: boolean;
  explanation: { explanation: string; source: string } | null;
  rerun: (key: string) => Promise<void>; copy: () => Promise<void>; explain: () => Promise<void>;
  print?: () => void; startOver?: () => void; claimLabel?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (decision) heading.current?.focus(); }, [decision]);
  if (!decision && !photos.some((photo) => photo.result)) return null;
  return <section className="claim-results space-y-6" aria-labelledby="results-title">
    <h2 id="results-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold">Your claim review</h2>
    {claimLabel ? <p className="font-semibold">{claimLabel}</p> : null}
    {decision ? <div className="card card-border bg-base-100"><div className="card-body"><h3 className="card-title">Agent activity</h3>
      <ul className="timeline timeline-vertical timeline-compact">{decision.timeline.map((step) => <li key={step.sequence}>
        {step.sequence > 1 ? <hr /> : null}<div className="timeline-middle"><span className="badge badge-sm" aria-hidden="true">{step.sequence}</span></div>
        <div className="timeline-end timeline-box my-2 max-w-full"><p className="text-sm">{step.message}</p><span className={`badge badge-sm mt-2 ${step.status === "pending" ? "badge-warning" : step.status === "unavailable" ? "badge-error" : ""}`}>{step.status}</span>{step.ruleHits.length ? <p className="mt-1 text-xs">Rules: {step.ruleHits.join(", ")}</p> : null}</div>
        {step.sequence < decision.timeline.length ? <hr /> : null}
      </li>)}</ul>
    </div></div> : <div className="alert" role="status">Photo evidence is available. A current decision has not been completed.</div>}
    <div className="grid gap-4 md:grid-cols-2">{photos.map((photo) => <EvidenceCard key={photo.key} photo={photo} code={code} disabled={busy} rerun={rerun} />)}</div>
    {decision ? <div className="card card-border bg-base-100"><div className="card-body gap-5">
      <div className={`stats stats-vertical border text-base-content ${decision.decision === "Auto-approve" ? "border-success bg-success/15" : decision.decision === "Escalate" ? "border-error bg-error/15" : "border-warning bg-warning/15"}`} role="status">
        <div className="stat"><div className="stat-title text-current">Guardrail decision</div><div className="stat-value whitespace-normal text-3xl">{decision.decision}</div><div className="stat-desc whitespace-normal text-current">Rule version {decision.ruleVersion} · human submission still required</div></div>
      </div>
      <div><h3 className="font-semibold">Reasons</h3>{decision.reasons.length ? <ul className="mt-2 list-disc space-y-2 pl-5">{decision.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p className="mt-2">No escalation rule was triggered. This does not prove the photos are original.</p>}</div>
      {decision.notes.length ? <div><h3 className="font-semibold">Notes for review</h3><ul className="mt-2 list-disc space-y-2 pl-5">{decision.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div> : null}
      <div><h3 className="font-semibold">Photo lookup summary</h3><p className="mt-2 text-sm">{decision.lookupSummary}</p></div>
      {llmConfigured ? <button type="button" className="btn" disabled={busy} onClick={() => void explain()}>Generate optional adjuster summary</button> : null}
      {explanation ? <div className="alert" role="status"><div><p className="font-semibold">{explanation.source === "llm" ? "AI-written summary · review for accuracy" : "Deterministic summary · AI unavailable"}</p><p className="mt-2">{explanation.explanation}</p><p className="mt-2 text-xs">Supplementary wording only; the guardrail decision above is unchanged.</p></div></div> : null}
      <div className="alert" role="note">You must sign in with your own Google account and click Submit. The agent never submits for you.</div>
      <div className="card-actions justify-start no-print">{decision.prefillUrl ? <a className="btn" href={decision.prefillUrl} target="_blank" rel="noopener noreferrer">Open pre-filled form ↗</a> : <span className="badge badge-warning">Form unavailable until the claim is ready</span>}<button className="btn" type="button" disabled={busy} onClick={() => void copy()}>Copy summary</button><button className="btn" type="button" disabled={busy} onClick={print}>Save as PDF</button><button className="btn btn-outline" type="button" disabled={busy} onClick={startOver}>Start Over</button></div>
      <p className="text-xs no-print">This clears the form on your screen. It doesn&apos;t delete anything from the database.</p>
      <p className="text-sm"><span className="font-semibold">Adjuster notification: </span>{notificationLabels[decision.escalation]}</p>
    </div></div> : null}
  </section>;
}
