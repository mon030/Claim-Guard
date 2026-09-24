"use client";
import { useState } from "react";
import { useClaimGuard } from "../lib/client/use-claim-guard";
import { ClaimFields } from "./claim-fields";
import { PhotoUploader } from "./photo-uploader";
import { PhotoPreview } from "./photo-preview";
import { Results } from "./results";
import { ClaimPicker } from "./claim-picker";
import { HowItWorks } from "./how-it-works";
import { Toasts } from "./toasts";
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function ClaimGuardApp() {
  const app = useClaimGuard(); const [enteredCode, setEnteredCode] = useState("");
  const canAccess = Boolean(app.config && (!app.config.demoAccessRequired || app.code));
  return <div className="app-shell"><div className="app-scroll"><main className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-6 sm:py-12">
    <header className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold tracking-wide">MERIDIAN INSURANCE</p><span className="badge">BUAN 3301 · Course demo</span></div>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ClaimGuard</h1><p className="max-w-2xl text-lg text-base-content/75">Check claim photos for reuse, understand the evidence, and leave the final form submission to a real person.</p>
    </header>
    <HowItWorks />
    {app.config?.demoAccessRequired && (!app.code || app.error && !app.claims.length) ? <form className="card card-border bg-base-100" onSubmit={(event) => { event.preventDefault(); app.setCode(enteredCode.trim()); app.retryLoading(); }}><div className="card-body"><h2 className="card-title">Demo access</h2><p>No account or login is needed. Enter the team’s shared demo code once for this page.</p><label className="fieldset">Access code<input required type="password" className="input w-full" autoComplete="off" value={enteredCode} onChange={(event) => setEnteredCode(event.target.value)} /></label><button className="btn" disabled={app.loading}>Continue</button></div></form> : null}
    {app.error ? <div className={`alert ${["mapping_required", "references_incomplete"].includes(app.errorCode) ? "alert-warning" : "alert-error"}`} role="alert"><div><p className="font-semibold">{["mapping_required", "references_incomplete"].includes(app.errorCode) ? "Check blocked" : "Something needs attention"}</p><p>{app.error}</p><button className="btn mt-3" type="button" disabled={app.loading || app.busy} onClick={app.tryAgain}>Try again</button></div></div> : null}
    <p aria-live="polite" aria-atomic="true" className="min-h-6 text-sm text-base-content/75">{app.busy ? `Processing · ${app.progress} of ${app.photos.length} lookups finished. Please keep this page open.` : app.notice}</p>
    <form className="card card-border bg-base-100" onSubmit={(event) => { event.preventDefault(); void app.run(); }} aria-busy={app.busy}>
      <div className="card-body gap-7 p-5 sm:p-8">
        <fieldset className="fieldset" disabled={app.busy}><legend className="fieldset-legend text-base">1. Choose your claim</legend><div className="grid gap-3 sm:grid-cols-2">
          {(["existing", "new"] as const).map((mode) => <label key={mode} className={`flex cursor-pointer items-center gap-3 rounded-field border p-4 ${app.mode === mode ? "border-base-content bg-base-200" : "border-base-300"}`}><input className="radio" type="radio" name="claim-mode" checked={app.mode === mode} onChange={() => app.switchMode(mode)} /><span>{mode === "existing" ? "Select existing claim" : "Submit new claim"}</span></label>)}
        </div></fieldset>
        {app.mode === "existing" ? <section className="space-y-4" aria-label="Existing claim details">
          <ClaimPicker key={app.resetVersion} claims={app.claims} selectedId={app.selectedId} disabled={app.busy || app.loading || !canAccess} choose={app.chooseClaim} />
          {app.loading ? <span className="loading loading-spinner" aria-label="Loading claims" /> : null}
          {canAccess && !app.loading && !app.claims.length ? <div className="alert" role="status">No seeded claims are available. The team must seed the instructor’s dataset before existing claims can be selected.</div> : null}
          {app.claims.some((claim) => claim.unavailableReason) ? <div className="alert alert-warning" role="status">Unavailable claims need their two photos mapped by the team and re-seeded. ClaimGuard never guesses a mapping.</div> : null}
          {app.selected ? <><div className="rounded-box bg-base-200 p-4"><h2 className="text-lg font-semibold">{app.selected.claimId} · {app.selected.claimant}</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{[["Incident date", app.selected.date], ["Amount", money(app.selected.amount)], ["Location", app.selected.location], ["Category", app.selected.category], ["Customer email", app.selected.customerEmail]].map(([name, value]) => <div key={name}><dt className="text-base-content/70">{name}</dt><dd className="break-words font-medium">{value || "Not provided"}</dd></div>)}</dl><h3 className="mt-4 text-sm font-semibold">Claim description</h3><p className="mt-2 whitespace-pre-wrap text-sm">{app.selected.narrative}</p></div>
            <h2 className="card-title">2. Mapped claim photos</h2><div className="grid gap-4 sm:grid-cols-2">{app.photos.map((photo) => <article className="card card-border" key={photo.key}><div className="card-body"><PhotoPreview photoId={photo.seedId} code={app.code} filename={photo.filename} /><h3 className="text-sm font-semibold">{photo.filename}</h3><span className="badge">{photo.status}</span>{photo.error ? <p className="text-sm text-error">{photo.error}</p> : null}</div></article>)}</div></> : null}
        </section> : <>
          <ClaimFields draft={app.draft} change={app.changeDraft} disabled={app.busy} importFile={app.importDescription} />
          {app.config?.llmConfigured ? <div className="space-y-3"><button type="button" className="btn" disabled={app.busy || !canAccess || !app.draft.narrative.trim()} onClick={() => void app.suggestFields()}>Suggest fields from description</button><p className="text-xs text-base-content/70">Optional: sends only the description to your configured language-model provider.</p></div> : null}
          {app.suggestion ? <div className="alert" role="status"><div><p className="font-semibold">Suggested fields ({app.suggestion.source})</p><p>Claim ID: {app.suggestion.claimId ?? "Not found"}</p><p>Claimant: {app.suggestion.claimant ?? "Not found"}</p><button type="button" className="btn mt-3" disabled={app.busy} onClick={app.applySuggestion}>Apply to empty fields only</button></div></div> : null}
          <PhotoUploader photos={app.photos} disabled={app.busy} add={app.addFiles} remove={app.removePhoto} code={app.code} />
        </>}
        <div className="space-y-4 border-t border-base-300 pt-6">
          {app.blocked ? <div className="alert" role="status"><span><span className="badge badge-warning mr-2">Not ready</span>{app.blocked}</span></div> : null}
          {app.busy ? <div className="space-y-2"><label htmlFor="lookup-progress" className="text-sm">Photo checks: {app.progress} / {app.photos.length}</label><progress id="lookup-progress" className="progress w-full" value={app.progress} max={Math.max(1, app.photos.length)} /></div> : null}
          <button className="btn btn-primary w-full" type="submit" disabled={app.busy || !canAccess || Boolean(app.blocked)}>{app.busy ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}Run ClaimGuard check</button>
          <p className="text-center text-xs text-base-content/70">Analyzes evidence only. Does not submit a claim or Google Form.</p>
        </div>
      </div>
    </form>
    <Results decision={app.decision} photos={app.photos} code={app.code} busy={app.busy} llmConfigured={Boolean(app.config?.llmConfigured)} explanation={app.explanation} rerun={app.rerun} copy={app.copySummary} explain={app.explain} print={app.printResults} startOver={app.startOver} claimLabel={app.claimLabel} />
    <footer className="border-t border-base-300 pt-5 text-xs text-base-content/70">Meridian Insurance is fictional. This university-course prototype assists review; it does not establish fraud or replace an adjuster.</footer>
  </main></div><Toasts items={app.toasts} dismiss={app.dismissToast} /></div>;
}
