"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaimOption, UiConfiguration } from "../api/claim-contracts";
import type { DecideResponse, LookupResponse } from "../api/contracts";
import { api, ClientApiError, jsonBody, lookupApi, runPool } from "./api";
import { collectImages, MAX_BATCH_BYTES, readDescription } from "./files";
import { preparePhoto, type PreparedPhoto } from "./images";
import { claimAmountSchema } from "../claim-validation";
import { useToasts } from "./use-toasts";

export interface ClaimDraft { claimId: string; claimant: string; narrative: string; date: string; amount: string; location: string; category: string; customerEmail: string; }
export interface PhotoItem {
  key: string; filename: string; file?: File; seedId?: string; prepared?: PreparedPhoto;
  status: "queued" | "hashing" | "looking up" | "done" | "error";
  result?: LookupResponse; error?: string;
}
const emptyDraft: ClaimDraft = { claimId: "", claimant: "", narrative: "", date: "", amount: "", location: "", category: "", customerEmail: "" };
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

export function useClaimGuard() {
  const { toasts, notify, dismiss } = useToasts();
  const [resetVersion, setResetVersion] = useState(0);
  const retryWork = useRef<(() => Promise<void>) | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [config, setConfig] = useState<UiConfiguration | null>(null);
  const [code, setCode] = useState("");
  const [claims, setClaims] = useState<ClaimOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ClaimDraft>(emptyDraft);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [decision, setDecision] = useState<DecideResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);
  const [suggestion, setSuggestion] = useState<{ claimId: string | null; claimant: string | null; source: string } | null>(null);
  const [explanation, setExplanation] = useState<{ explanation: string; source: string } | null>(null);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const savedClaim = useRef<{ fingerprint: string; requestId: string; claimId?: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const settings = await api<UiConfiguration>("/api/config", "", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setConfig(settings);
        if (settings.demoAccessRequired && !code) return;
        const result = await api<{ claims: ClaimOption[] }>("/api/claims", code, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setClaims(result.claims); setError("");
      } catch (failure) { if (!controller.signal.aborted) setError(messageOf(failure)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [code, reload]);

  const selected = claims.find((claim) => claim.claimId === selectedId);
  const invalidate = useCallback(() => { setDecision(null); setExplanation(null); setError(""); setErrorCode(""); setNotice(""); retryWork.current = null; }, []);
  function switchMode(value: "existing" | "new") {
    if (lock.current) return;
    setMode(value); setPhotos([]); setSelectedId(""); setProgress(0); invalidate();
  }
  function chooseClaim(claimId: string) {
    if (lock.current) return;
    setSelectedId(claimId); invalidate(); setProgress(0);
    const claim = claims.find((entry) => entry.claimId === claimId);
    setPhotos((claim?.photos ?? []).map((photo) => ({ key: photo.photoId, seedId: photo.photoId, filename: photo.filename, status: "queued" })));
  }
  function changeDraft(key: keyof ClaimDraft, value: string) {
    if (lock.current) return;
    setDraft((current) => ({ ...current, [key]: value })); invalidate(); setSuggestion(null);
    setPhotos((current) => current.map((photo) => ({ ...photo, status: "queued", result: undefined, error: undefined })));
  }
  async function exclusive(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await work(); }
    catch (failure) {
      if (mounted.current) { retryWork.current = work; setError(messageOf(failure)); setErrorCode(failure instanceof ClientApiError ? failure.code : "client_error"); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const patchPhoto = (key: string, patch: Partial<PhotoItem>) => setPhotos((current) => current.map((photo) => photo.key === key ? { ...photo, ...patch } : photo));
  async function addFiles(files: File[]) {
    await exclusive(async () => {
      invalidate();
      const collected = await collectImages(files);
      const total = [...photos.flatMap((photo) => photo.file ? [photo.file] : []), ...collected];
      if (total.length > 50 || total.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) throw new Error("Your combined selection must stay within 50 images and 30 MB. Remove files first.");
      setPhotos((current) => [...current, ...collected.map((file): PhotoItem => ({ key: crypto.randomUUID(), filename: file.name, file, status: "queued" }))]);
      setNotice(collected.length + " images added. No photos were mapped or selected automatically.");
    });
  }
  function removePhoto(key: string) { if (!lock.current) { setPhotos((current) => current.filter((photo) => photo.key !== key).map((photo) => ({ ...photo, result: undefined, status: "queued", error: undefined }))); invalidate(); } }
  async function importDescription(file: File) {
    await exclusive(async () => {
      const text = await readDescription(file);
      if (draft.narrative.length + text.length + 2 > 10_000) throw new Error("The combined description would exceed 10,000 characters. Clear or shorten it first.");
      setDraft((current) => ({ ...current, narrative: current.narrative ? `${current.narrative}\n\n${text}` : text }));
      invalidate(); setSuggestion(null); savedClaim.current = null;
      setPhotos((current) => current.map((photo) => ({ ...photo, status: "queued", result: undefined })));
      setNotice("Description text imported. Existing text was preserved.");
    });
  }
  async function suggestFields() {
    await exclusive(async () => { setError(""); setSuggestion(await api("/api/suggest", code, jsonBody({ text: draft.narrative }))); });
  }
  function applySuggestion() {
    if (!suggestion || lock.current) return;
    setDraft((current) => ({ ...current, claimId: current.claimId || suggestion.claimId || "", claimant: current.claimant || suggestion.claimant || "" }));
    invalidate(); setSuggestion(null); setNotice("Applied suggestions to empty fields only.");
    setPhotos((current) => current.map((photo) => ({ ...photo, status: "queued", result: undefined })));
  }
  async function currentClaimId(): Promise<string> {
    if (mode === "existing") {
      if (!selected || selected.unavailableReason) throw new Error(selected?.unavailableReason ?? "Select a mapped claim first.");
      return selected.claimId;
    }
    if (!draft.claimant.trim() || !draft.narrative.trim() || !draft.date || !draft.amount.trim()) throw new Error("Enter a claimant, description, incident date, and claim amount.");
    const amount = claimAmountSchema.safeParse(Number(draft.amount));
    if (!amount.success) throw new Error(amount.error.issues[0].message);
    const fingerprint = JSON.stringify(draft);
    if (savedClaim.current?.fingerprint !== fingerprint) savedClaim.current = { fingerprint, requestId: crypto.randomUUID() };
    if (savedClaim.current.claimId) return savedClaim.current.claimId;
    const result = await api<{ claimId: string }>("/api/claims", code, jsonBody({ ...draft, amount: Number(draft.amount), clientRequestId: savedClaim.current.requestId }));
    savedClaim.current.claimId = result.claimId; setNotice(`Working on claim ${result.claimId}.`);
    return result.claimId;
  }
  async function lookup(photo: PhotoItem, index: number, claimId: string, forceLive: boolean): Promise<LookupResponse> {
    try {
      let result: LookupResponse;
      if (photo.seedId) {
        patchPhoto(photo.key, { status: "looking up", error: undefined });
        result = await lookupApi(code, jsonBody({ photoId: photo.seedId, forceLive }));
      } else {
        if (!photo.file) throw new Error("Original photo is no longer available. Select it again.");
        patchPhoto(photo.key, { status: "hashing", error: undefined });
        const prepared = photo.prepared ?? await preparePhoto(photo.file);
        patchPhoto(photo.key, { prepared, status: "looking up" });
        const form = new FormData(); form.set("file", prepared.file); form.set("claimId", claimId);
        form.set("slot", String(index + 1)); form.set("forceLive", String(forceLive)); form.set("resized", String(prepared.resized));
        result = await lookupApi(code, { method: "POST", body: form });
        if (result.evidence.sha256 !== prepared.sha256) throw new Error("The received photo hash differs from the uploaded bytes. Please retry.");
      }
      patchPhoto(photo.key, { result, status: result.evidence.webCheck.status === "ok" ? "done" : "error",
        error: result.evidence.webCheck.status === "unavailable" ? result.lookup.message ?? result.lookup.reason ?? "Web check unavailable." : undefined });
      return result;
    } catch (failure) { patchPhoto(photo.key, { status: "error", error: messageOf(failure), result: undefined }); throw failure; }
  }
  async function decideClaim(claimId: string, results: LookupResponse[]) {
    const result = await api<DecideResponse>("/api/decide", code, jsonBody({ claimId, photoIds: results.map((photo) => photo.photoId) }));
    setDecision(result);
    notify(result.decision === "Auto-approve" ? "Check complete: auto-approve." : result.decision === "Escalate" ? "Check complete: human review needed." : "Check blocked: review the missing information.", result.decision === "Auto-approve" ? "success" : "warning");
    if (results.some((photo) => photo.lookup.status === "unavailable")) notify("Some photos could not be checked against the web.", "warning");
    if (results.some((photo) => photo.lookup.status === "unavailable")) setError("One or more web checks are unavailable. Review the per-photo errors and the guardrail decision; unavailable never means no matches.");
  }
  async function run() {
    await exclusive(async () => {
      invalidate(); setProgress(0);
      if (photos.length < 2 || photos.length > (mode === "existing" ? 2 : 6)) throw new Error("Choose between two and six photos; existing claims require their two mapped photos.");
      const claimId = await currentClaimId();
      const outcomes = await runPool(photos, async (photo, index) => {
        try { return await lookup(photo, index, claimId, false); }
        finally { setProgress((current) => current + 1); }
      }, 2);
      if (outcomes.some((outcome) => outcome.status === "rejected")) throw new Error("Some lookups failed to save. Review each photo's error, then run the check again. No decision was requested.");
      await decideClaim(claimId, outcomes.map((outcome) => (outcome as PromiseFulfilledResult<LookupResponse>).value));
    });
  }
  async function rerun(key: string) {
    await exclusive(async () => {
      invalidate();
      const index = photos.findIndex((photo) => photo.key === key), photo = photos[index];
      if (!photo) return;
      const claimId = await currentClaimId();
      const latest = await lookup(photo, index, claimId, true);
      const results = photos.map((entry) => entry.key === key ? latest : entry.result);
      if (results.every((entry): entry is LookupResponse => Boolean(entry))) await decideClaim(claimId, results);
      else setNotice("Live lookup finished. Run the check after the remaining photos have been looked up.");
    });
  }
  async function explain() {
    if (!decision) return;
    await exclusive(async () => { setExplanation(await api("/api/explanation", code, jsonBody({ decisionId: decision.decisionId }))); });
  }
  async function copySummary() {
    if (!decision) return;
    try {
      await navigator.clipboard.writeText([`Claim ${mode === "existing" ? selectedId : savedClaim.current?.claimId ?? draft.claimId}`, decision.decision,
        decision.lookupSummary, ...decision.reasons, ...decision.notes, "A human must sign in and submit the form."].join("\n"));
      setNotice("Summary copied.");
    } catch { setError("Clipboard access was denied. Select and copy the visible results instead."); }
  }
  function startOver() {
    if (lock.current) return;
    invalidate(); setMode("existing"); setSelectedId(""); setDraft({ ...emptyDraft }); setPhotos([]);
    setSuggestion(null); setProgress(0); savedClaim.current = null; setResetVersion((value) => value + 1);
    notify("Form cleared. Saved database records are unchanged.", "info");
  }
  function printResults() {
    window.print();
    notify("Print dialog opened. Choose Save as PDF to save.", "info");
  }
  function tryAgain() {
    setError("");
    if (retryWork.current) void exclusive(retryWork.current);
    else if (decision && photos.length >= 2) void run();
    else setReload((value) => value + 1);
  }
  const blocked = mode === "existing" ? (!selected ? "Select an available claim to begin." : selected.unavailableReason ?? "")
    : photos.length < 2 ? "Add at least two photos before running the check." : photos.length > 6 ? "Remove photos until two to six remain. No files will be silently skipped." : "";
  return { mode, switchMode, config, code, setCode, claims, selectedId, selected, chooseClaim, draft, changeDraft,
    toasts, dismissToast: dismiss, startOver, printResults, tryAgain, resetVersion,
    claimLabel: mode === "existing" ? `${selectedId} · ${selected?.claimant ?? ""}` : `${savedClaim.current?.claimId ?? draft.claimId} · ${draft.claimant}`,
    photos, decision, busy, loading, error, errorCode, notice, progress, suggestion, explanation, blocked,
    addFiles, removePhoto, importDescription, suggestFields, applySuggestion, run, rerun, explain, copySummary,
    retryLoading: () => setReload((value) => value + 1) };
}
