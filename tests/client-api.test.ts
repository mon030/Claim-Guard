import { afterEach, describe, expect, it, vi } from "vitest";
import { api, jsonBody, lookupApi } from "../lib/client/api";

afterEach(() => vi.useRealTimers());
const databaseFailure = (retryable: boolean) => Response.json({ error: {
  code: "database_unavailable", message: "Database unavailable", retryable,
} }, { status: 503 });

describe("lookup recovery", () => {
  it.each(["/api/claims", "/api/decide"])("retries %s once and preserves the decision request key", async (path) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "database_unavailable", retryable: true }, { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = api(path, "", path === "/api/decide" ? jsonBody({ claimId: "TEST", photoIds: [] }) : {});
    await vi.advanceTimersByTimeAsync(600); expect(await pending).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (path === "/api/decide") expect(fetchMock.mock.calls[1][1].headers.get("Idempotency-Key")).toBe(fetchMock.mock.calls[0][1].headers.get("Idempotency-Key"));
  });
  it("retries once after a safe database failure, preserving JSON and access header", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(databaseFailure(true)).mockResolvedValueOnce(Response.json({ photoId: "saved" }));
    vi.stubGlobal("fetch", fetchMock);
    const init = jsonBody({ photoId: "synthetic", forceLive: true });
    const pending = lookupApi("demo", init);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({ photoId: "saved" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ photoId: "synthetic", forceLive: false });
    expect(fetchMock.mock.calls[1][1].headers.get("x-demo-access-code")).toBe("demo");
  });
  it("reuses multipart bytes without turning one photo into a batch", async () => {
    vi.useFakeTimers();
    const form = new FormData(); form.set("file", new Blob(["synthetic image"]), "test.jpg");
    const fetchMock = vi.fn().mockResolvedValueOnce(databaseFailure(true)).mockResolvedValueOnce(Response.json({ photoId: "saved" }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = lookupApi("", { method: "POST", body: form });
    await vi.advanceTimersByTimeAsync(1_000); await pending;
    expect(fetchMock.mock.calls[1][1].body.get("file")).toBe(form.get("file"));
    expect(fetchMock.mock.calls[1][1].body.get("forceLive")).toBe("false");
    expect(form.getAll("file")).toHaveLength(1);
  });
  it("stops after a second failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => databaseFailure(true));
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(lookupApi("", jsonBody({ photoId: "synthetic" }))).rejects.toMatchObject({ code: "database_unavailable" });
    await vi.advanceTimersByTimeAsync(1_000); await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    [503, "database_unavailable", false], [503, "configuration_error", true],
    [503, "service_unavailable", false], [429, "rate_limited", true], [401, "access_denied", false],
  ])("does not replay status %s / %s with retryable=%s", async (status, code, retryable) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ error: { code, message: "synthetic failure", retryable } }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupApi("", jsonBody({ photoId: "synthetic", forceLive: true }))).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not replay a network failure with an unknown server outcome", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network error"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupApi("", jsonBody({ photoId: "synthetic" }))).rejects.toThrow("network error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
