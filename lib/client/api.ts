export class ClientApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number,
    public readonly retryable = false) { super(message); }
}
export async function api<T>(path: string, accessCode: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessCode) headers.set("x-demo-access-code", accessCode);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ClientApiError(body?.error?.message ?? `Request failed (${response.status}). Please retry.`, body?.error?.code ?? "request_failed", response.status, body?.error?.retryable === true);
  if (!body) throw new Error("The server returned an unreadable response.");
  return body as T;
}
/** Only replay a lookup when the server confirms no paid Vision attempt occurred. */
export async function lookupApi<T>(accessCode: string, init: RequestInit): Promise<T> {
  try { return await api<T>("/api/lookup", accessCode, init); }
  catch (error) {
    if (!(error instanceof ClientApiError) || error.status !== 503 || error.code !== "database_unavailable" || !error.retryable) throw error;
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    init.signal?.throwIfAborted();
    return api<T>("/api/lookup", accessCode, init);
  }
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
