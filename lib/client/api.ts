export class ClientApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number,
    public readonly retryable = false) { super(message); }
}
export async function api<T>(path: string, accessCode: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessCode) headers.set("x-demo-access-code", accessCode);
  if (path === "/api/decide" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", crypto.randomUUID());
  const retryablePath = ["/api/lookup", "/api/decide", "/api/claims"].includes(path);
  let response: Response;
  let body;
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    response = await fetch(path, { ...init, headers, cache: "no-store" });
    body = await response.json().catch(() => null);
    if (attempt === 0 && retryablePath && response.status === 503 && (body?.error === "database_unavailable" || body?.error?.code === "database_unavailable") && (body?.retryable === true || body?.error?.retryable === true)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      // Replays can use a successfully cached paid result, even after "re-run live".
      if (path === "/api/lookup") {
        if (init.body instanceof FormData) { const form = new FormData(); init.body.forEach((value, key) => form.append(key, value)); form.set("forceLive", "false"); init = { ...init, body: form }; }
        else if (typeof init.body === "string") { const input = JSON.parse(init.body); init = { ...init, body: JSON.stringify({ ...input, forceLive: false }) }; }
      }
      continue;
    }
    if (attempt > 0 && response.ok && typeof window !== "undefined") window.dispatchEvent(new Event("claimguard:retry-recovered"));
    break;
  }
  if (!response.ok) throw new ClientApiError(body?.message ?? body?.error?.message ?? `Request failed (${response.status}). Please retry.`, typeof body?.error === "string" ? body.error : body?.error?.code ?? "request_failed", response.status, body?.retryable === true || body?.error?.retryable === true);
  if (!body) throw new Error("The server returned an unreadable response.");
  return body as T;
}
/** Kept as the Phase 5 interface; retries are shared by all three endpoints. */
export async function lookupApi<T>(accessCode: string, init: RequestInit): Promise<T> {
  return api<T>("/api/lookup", accessCode, init);
}
export const jsonBody = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** Finish every started task before returning an error or allowing a decision. */
export async function runPool<T, R>(items: readonly T[], work: (item: T, index: number) => Promise<R>, concurrency = 2): Promise<PromiseSettledResult<R>[]> {
  const output: PromiseSettledResult<R>[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = { status: "fulfilled", value: await work(items[index], index) }; }
      catch (reason) { output[index] = { status: "rejected", reason }; }
    }
  }));
  return output;
}
