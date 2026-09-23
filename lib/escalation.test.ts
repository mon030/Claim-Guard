import { afterEach, expect, it, vi } from "vitest";
import { notifyEscalation } from "./escalation";
import type { ClaimEvidence, GuardrailResult } from "./guardrail";

const claim: ClaimEvidence = { claimId: "SYNTHETIC", claimant: "Test Person", customerEmail: "not-sent@example.test", date: "2026-09-01", amount: 10, narrative: "Not sent", photos: [] };
const result: GuardrailResult = { decision: "Escalate", reasons: ["Synthetic reason"], notes: [], ruleHits: ["E4"], ruleVersion: "test" };
afterEach(() => vi.useRealTimers());
it("bounds webhook failures to one second and logs no upstream details", async () => {
  vi.stubEnv("ESCALATION_WEBHOOK_URL", "https://adjuster.example/test"); vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("secret-detail")));
  }));
  vi.stubGlobal("fetch", fetchMock);
  const pending = notifyEscalation(claim, result);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await pending).toBe("failed"); expect(vi.getTimerCount()).toBe(0);
  expect(fetchMock.mock.calls[0][1]!.body).not.toContain(claim.customerEmail);
});
it("does not send notifications for approved or blocked decisions", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  for (const decision of ["Auto-approve", "Blocked"] as const) expect(await notifyEscalation(claim, { ...result, decision })).toBe("not_required");
  expect(fetchMock).not.toHaveBeenCalled();
});
