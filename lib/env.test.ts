import { describe, expect, it } from "vitest";
import { getEnv, getFormEnv, getLlmEnv, getMongoEnv, getOptionalEnv, getVisionEnv } from "./env";

const requiredEnv = {
  GOOGLE_VISION_API_KEY: "test-key",
  MONGODB_URI: "mongodb://localhost:27017",
  GOOGLE_FORM_URL: "https://docs.google.com/forms/d/e/test-form/viewform",
  GOOGLE_FORM_ENTRY_CLAIM_ID: "entry.1",
  GOOGLE_FORM_ENTRY_CLAIMANT: "2",
  GOOGLE_FORM_ENTRY_LOOKUP: "3",
  GOOGLE_FORM_ENTRY_DECISION: "4",
};

describe("lazy environment validation", () => {
  it("uses documented defaults without requiring an LLM", () => {
    expect(getEnv(requiredEnv)).toMatchObject({ MONGODB_DB: "claimguard", DAILY_VISION_LIMIT: 200, DAILY_LLM_LIMIT: 200 });
    expect(getLlmEnv({})).toBeNull();
    expect(getLlmEnv({ LLM_API_KEY: "  ", LLM_API_BASE_URL: "", LLM_MODEL: "" })).toBeNull();
  });
  it("reports each missing required variable by name", () => {
    let message = "";
    try { getEnv({}); } catch (error) { message = (error as Error).message; }
    for (const key of Object.keys(requiredEnv)) expect(message).toContain(key);
  });
  it("validates only the integration being used", () => {
    expect(getVisionEnv({ GOOGLE_VISION_API_KEY: " key " }).GOOGLE_VISION_API_KEY).toBe("key");
    expect(getMongoEnv({ MONGODB_URI: requiredEnv.MONGODB_URI }).MONGODB_DB).toBe("claimguard");
  });
  it("rejects every partial LLM configuration", () => {
    const all = { LLM_API_KEY: "test", LLM_API_BASE_URL: "https://provider.example/v1", LLM_MODEL: "test-model" };
    const keys = Object.keys(all) as (keyof typeof all)[];
    for (let mask = 1; mask < 7; mask++) {
      const partial = Object.fromEntries(keys.filter((_, index) => mask & (1 << index)).map((key) => [key, all[key]]));
      expect(() => getLlmEnv(partial)).toThrow("is required when any LLM_*");
      expect(() => getEnv({ ...requiredEnv, ...partial })).toThrow();
    }
  });
  it("accepts compatible hosted and local provider URLs", () => {
    for (const baseUrl of ["https://api.openai.com/v1", "https://generativelanguage.googleapis.com/v1beta/openai/", "http://localhost:8080/v1"]) {
      expect(getLlmEnv({ LLM_API_KEY: "key", LLM_API_BASE_URL: baseUrl, LLM_MODEL: "model" })).toEqual({ apiKey: "key", baseUrl, model: "model" });
    }
  });
  it("rejects query-string, credential, or non-HTTP provider bases", () => {
    for (const url of ["file:///tmp/llm", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret"]) {
      expect(() => getLlmEnv({ LLM_API_KEY: "key", LLM_API_BASE_URL: url, LLM_MODEL: "model" })).toThrow("LLM_API_BASE_URL");
    }
  });
  it("accepts zero as a deliberate service limit, but rejects negative/fractional limits", () => {
    expect(getOptionalEnv({ DAILY_VISION_LIMIT: "0" }).DAILY_VISION_LIMIT).toBe(0);
    for (const value of ["-1", "1.5", "NaN", "Infinity"]) expect(() => getOptionalEnv({ DAILY_LLM_LIMIT: value })).toThrow("DAILY_LLM_LIMIT");
  });
  it("validates form entry IDs and full form URL", () => {
    expect(() => getFormEnv({ ...requiredEnv, GOOGLE_FORM_ENTRY_LOOKUP: "emailAddress" })).toThrow("GOOGLE_FORM_ENTRY_LOOKUP");
    expect(() => getFormEnv({ ...requiredEnv, GOOGLE_FORM_URL: "https://forms.gle/short" })).toThrow("full Google Form");
  });
  it("does not put secret values in validation errors", () => {
    expect(() => getMongoEnv({ MONGODB_URI: "secret-invalid-uri" })).toThrow("MONGODB_URI");
    try { getMongoEnv({ MONGODB_URI: "secret-invalid-uri" }); } catch (error) {
      expect((error as Error).message).not.toContain("secret-invalid-uri");
    }
  });
  it("reports exact missing-var messages without eagerly requiring unrelated integrations", () => {
    expect(() => getVisionEnv({})).toThrow("Environment configuration error:\n- GOOGLE_VISION_API_KEY: is required");
    expect(() => getMongoEnv({})).toThrow("Environment configuration error:\n- MONGODB_URI: is required");
    expect(() => getFormEnv({ ...requiredEnv, GOOGLE_FORM_ENTRY_DECISION: undefined })).toThrow("GOOGLE_FORM_ENTRY_DECISION: is required");
    expect(() => getLlmEnv({ LLM_MODEL: "test" })).toThrow("LLM_API_KEY: is required when any LLM_* variable is set");
  });
  it("never accepts Google Forms as a POST destination", () => {
    for (const url of ["https://docs.google.com/forms/d/e/test/viewform", "https://forms.gle/test", "https://FORMS.GOOGLE.COM./test"]) {
      expect(() => getOptionalEnv({ ESCALATION_WEBHOOK_URL: url })).toThrow("must not point to Google Forms");
      expect(() => getLlmEnv({ LLM_API_KEY: "test", LLM_MODEL: "test", LLM_API_BASE_URL: url })).toThrow("Google Forms is not an API endpoint");
    }
  });
});
