"use client";
import type { PhotoItem } from "../lib/client/use-claim-guard";
import { PhotoPreview } from "./photo-preview";
export function EvidenceCard({ photo, code, disabled, rerun }: { photo: PhotoItem; code: string; disabled: boolean; rerun: (key: string) => Promise<void> }) {
  const result = photo.result;
  if (!result) return null;
  const { evidence, lookup } = result, web = evidence.webCheck;
  const hasMatches = web.fullMatchCount + web.partialMatchCount + web.similarCount > 0;
  return <article className="card card-border bg-base-100"><div className="card-body gap-4">
    <PhotoPreview key={evidence.sha256} photoId={result.photoId} code={code} filename={evidence.filename} />
    <h3 className="card-title break-all text-base">{evidence.filename}</h3>
    <div className="flex flex-wrap gap-2"><span className={`badge h-auto min-h-6 whitespace-normal ${web.status === "unavailable" ? "badge-error" : ""}`}>
      {web.status === "unavailable" ? "Web check unavailable" : lookup.source === "live" ? "Live" : `Cached at ${lookup.fetchedAt ? new Date(lookup.fetchedAt).toLocaleString() : "unknown time"}`}
    </span>{photo.prepared?.resized ? <span className="badge">Resized</span> : null}</div>
    <p className="text-xs"><span className="text-base-content/70">SHA-256 </span><code title={evidence.sha256}>{evidence.sha256.slice(0, 16)}…</code></p>
    {web.status === "ok" ? <dl className="grid grid-cols-2 gap-2 text-sm">
      <div><dt className="text-base-content/70">Full matches</dt><dd className="font-semibold">{web.fullMatchCount}</dd></div>
      <div><dt className="text-base-content/70">Non-stock full</dt><dd className="font-semibold">{web.nonStockFullMatchCount}</dd></div>
      <div><dt className="text-base-content/70">Partial matches</dt><dd className="font-semibold">{web.partialMatchCount}</dd></div>
      <div><dt className="text-base-content/70">Similar images</dt><dd className="font-semibold">{web.similarCount}</dd></div>
    </dl> : <div role="alert" className="alert alert-error text-sm">{lookup.reason === "daily_limit" ? "Daily Vision limit reached. A live retry cannot bypass this limit." : lookup.message ?? "Vision could not complete this check."}</div>}
    <div><h4 className="text-sm font-semibold">Top reported domains</h4>{web.domains.length ? <ul className="mt-2 space-y-2 text-sm">{web.domains.slice(0, 5).map((domain) => <li key={domain} className="flex flex-wrap items-center gap-2"><span className="break-all">{domain}</span><span className="badge badge-sm">{lookup.stockDomains?.includes(domain) ? "Stock allowlist" : "Not allow-listed"}</span></li>)}</ul> : <p className="mt-1 text-sm text-base-content/70">{web.status === "ok" ? "No domains returned." : "Unavailable—not a clean result."}</p>}</div>
    <div><h4 className="text-sm font-semibold">Cross-claim matches</h4>{result.matches.length ? <ul className="mt-2 space-y-3 text-sm">{result.matches.map((match, index) => <li key={`${match.claimId}-${match.filename}-${index}`} className="rounded-box bg-base-200 p-3">
      <p className="font-semibold">{match.claimId} · {match.date}</p><p>{match.claimant ?? "Claimant unavailable"}</p><p className="break-all">{match.filename}</p><p><span className="badge badge-sm">{match.matchType}</span> distance {match.distance}</p>
    </li>)}</ul> : <p className="mt-1 text-sm text-base-content/70">{lookup.referenceCoverage.available && !lookup.referenceCoverage.unmapped ? "No matches to other claims." : "Comparison incomplete; finish mapping and seeding."}</p>}</div>
    {lookup.warnings.length ? <div className="alert alert-warning text-sm" role="alert"><ul className="space-y-1">{lookup.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    {web.status === "unavailable" ? <div className="alert alert-warning text-sm" role="alert">This photo could not be verified against the web. Under our guardrail, an unverifiable photo is escalated for human review.</div> :
      <div className={`alert ${hasMatches ? "alert-warning" : "alert-success"} text-sm`}><div><p className="font-semibold">{hasMatches ? "Web checked: matches found" : "Web checked: no matches found"}</p><p>A similar image is not proof of reuse. An allow-listed domain is context, not an approval.</p></div></div>}
    <button className="btn" type="button" disabled={disabled} onClick={() => void rerun(photo.key)} aria-label={`Re-run live lookup for ${evidence.filename}`}>Re-run live lookup</button>
  </div></article>;
}
