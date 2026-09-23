import { describe, expect, it } from "vitest";
import { buildPrefillUrl, singleLineSummary, summarizePhotoLookups } from "./google-form";
import { toWebCheck } from "./vision";
const env = {
  GOOGLE_FORM_URL: "https://docs.google.com/forms/d/e/test/viewform?emailAddress=unwanted@example.test&entry.99=old#fragment",
  GOOGLE_FORM_ENTRY_CLAIM_ID: "entry.1", GOOGLE_FORM_ENTRY_CLAIMANT: "2", GOOGLE_FORM_ENTRY_LOOKUP: "3", GOOGLE_FORM_ENTRY_DECISION: "4",
};
const fields = { claimId: "TEST-ONLY", claimant: "Test & Person", lookup: "One\nTwo? & = #", decision: "Escalate" as const };
describe("human-only prefill", () => {
  it("sets only the four specified form entries plus prefill mode", () => {
    const url = new URL(buildPrefillUrl(fields, env));
    expect([...url.searchParams.keys()].sort()).toEqual(["entry.1", "entry.2", "entry.3", "entry.4", "usp"]);
    expect(url.searchParams.get("entry.2")).toBe(fields.claimant);
    expect(url.searchParams.get("entry.3")).toBe("One Two? & = #");
    expect(url.hash).toBe(""); expect(url.pathname).toMatch(/\/viewform$/);
  });
  it("rejects email fields and blocked decisions instead of inventing form values", () => {
    const unexpected = { ...fields, email: "test@example.test" };
    expect(() => buildPrefillUrl(unexpected, env)).toThrow();
    expect(() => buildPrefillUrl({ ...fields, decision: "Blocked" as "Escalate" }, env)).toThrow();
  });
  it("rejects overlapping form entry IDs", () => {
    expect(() => buildPrefillUrl(fields, { ...env, GOOGLE_FORM_ENTRY_LOOKUP: "entry.1" })).toThrow("distinct");
  });
  it.each(["Auto-approve", "Escalate"] as const)("preserves the exact %s decision string and URL encodings", (decision) => {
    const url = new URL(buildPrefillUrl({ ...fields, claimId: "A?&=# +测试", decision }, env));
    expect(url.searchParams.get("entry.1")).toBe("A?&=# +测试");
    expect(url.searchParams.get("entry.4")).toBe(decision);
    expect([...url.searchParams.keys()].some((key) => /email/i.test(key))).toBe(false);
  });
  it("limits lookup text to 300 characters, one line, with a truncation ellipsis", () => {
    const lookup = new URL(buildPrefillUrl({ ...fields, lookup: "x\n".repeat(400) }, env)).searchParams.get("entry.3")!;
    expect(lookup.length).toBeLessThanOrEqual(300); expect(lookup).not.toMatch(/[\r\n]/); expect(lookup.endsWith("…")).toBe(true);
    expect(singleLineSummary("x".repeat(300))).toHaveLength(300);
    expect(singleLineSummary("x".repeat(301))).toBe("x".repeat(299) + "…");
    expect(singleLineSummary("x".repeat(298) + "😀more")).not.toMatch(/[\uD800-\uDBFF]…/);
  });
  it("keeps both photo findings in the summary and accepts no claim narrative/email", () => {
    const photo = { filename: "long\n".repeat(100), sha256: "a".repeat(64), dhash: "0".repeat(16), crossClaimMatches: [], webCheck: toWebCheck(null) };
    const summary = summarizePhotoLookups([photo, { ...photo, filename: "two.jpg" }]);
    expect(summary).toContain("Photo 1"); expect(summary).toContain("Photo 2");
    expect(summary).toContain("web unavailable"); expect(summary.length).toBeLessThanOrEqual(300); expect(summary).not.toMatch(/[\r\n]/);
  });
});
