"use client";
import type { ClaimDraft } from "../lib/client/use-claim-guard";
import { claimAmountSchema, MAX_CLAIM_AMOUNT } from "../lib/claim-validation";
export function ClaimFields({ draft, change, disabled, importFile }: { draft: ClaimDraft; change: (key: keyof ClaimDraft, value: string) => void; disabled: boolean; importFile: (file: File) => Promise<void> }) {
  const amount = claimAmountSchema.safeParse(Number(draft.amount));
  const amountError = draft.amount && !amount.success ? amount.error.issues[0].message : "";
  return <fieldset className="fieldset gap-4" disabled={disabled}>
    <legend className="fieldset-legend text-base">Tell us about the claim</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="fieldset">Claim ID (optional)<input className="input w-full" value={draft.claimId} maxLength={80} pattern="[\p{L}\p{N}_\-]*" onChange={(event) => change("claimId", event.target.value)} /><span className="text-base-content/70">Blank IDs become MI-DEMO-####.</span></label>
      <label className="fieldset">Claimant name<input required className="input w-full" autoComplete="name" value={draft.claimant} maxLength={200} onChange={(event) => change("claimant", event.target.value)} /></label>
      <label className="fieldset">Incident date<input required type="date" className="input w-full" value={draft.date} onChange={(event) => change("date", event.target.value)} /></label>
      <label className="fieldset">Claim amount (USD)<input required type="number" min="0.01" max={MAX_CLAIM_AMOUNT} step="0.01" className={`input validator w-full ${amountError ? "input-error" : ""}`} value={draft.amount} aria-invalid={Boolean(amountError)} aria-describedby="amount-validation" onChange={(event) => change("amount", event.target.value)} /><span id="amount-validation" className={amountError ? "text-error" : "text-base-content/70"}>{amountError || `Greater than $0, up to $${MAX_CLAIM_AMOUNT.toLocaleString("en-US")}.`}</span></label>
      <label className="fieldset">Location (optional)<input className="input w-full" value={draft.location} maxLength={200} onChange={(event) => change("location", event.target.value)} /></label>
      <label className="fieldset">Category (optional)<input className="input w-full" value={draft.category} maxLength={100} onChange={(event) => change("category", event.target.value)} /></label>
      <label className="fieldset sm:col-span-2">Customer email (optional)<input type="email" className="input w-full" autoComplete="email" value={draft.customerEmail} onChange={(event) => change("customerEmail", event.target.value)} /><span className="text-base-content/70">Claim context only. Never used to fill the Google account email field.</span></label>
    </div>
    <label className="fieldset">Claim description<textarea required className="textarea min-h-36 w-full" maxLength={10_000} value={draft.narrative} onChange={(event) => change("narrative", event.target.value)} /><span className="text-base-content/70">{draft.narrative.length.toLocaleString()} / 10,000 characters</span></label>
    <label className="fieldset">Or import description text<input type="file" accept=".txt,.md,.docx" className="file-input w-full" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /><span className="text-base-content/70">TXT, Markdown, or Word · up to 3 MB. Imported text is appended, not substituted.</span></label>
  </fieldset>;
}
