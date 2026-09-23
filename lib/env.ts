import { z } from "zod";
import { isGoogleFormsHost } from "./outbound-policy";

type EnvironmentSource = Record<string, string | undefined>;
const required = z.string({ error: "is required" }).trim().min(1, "is required");
const optional = required.optional();
const httpUrl = required.refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !isGoogleFormsHost(url.hostname);
  } catch { return false; }
}, "must be an HTTP(S) base URL without credentials, query, or fragment; Google Forms is not an API endpoint");
const webhookUrl = required.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !isGoogleFormsHost(url.hostname);
  } catch { return false; }
}, "must be an HTTPS URL without credentials and must not point to Google Forms");
const entryId = required.regex(/^(?:entry\.)?\d+$/, "must be a numeric ID or entry.NUMERIC_ID");
const dailyLimit = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(200);

const databaseSchema = z.object({
  MONGODB_URI: required.regex(/^mongodb(?:\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
  MONGODB_DB: required.regex(/^[^/\\. "$*<>:|?\x00]+$/, "contains an invalid database-name character").default("claimguard"),
});
const visionSchema = z.object({ GOOGLE_VISION_API_KEY: required });
const formSchema = z.object({
  GOOGLE_FORM_URL: required.refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "docs.google.com" &&
        /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/viewform\/?$/.test(url.pathname);
    } catch { return false; }
  }, "must be the full Google Form https://docs.google.com/forms/.../viewform URL"),
  GOOGLE_FORM_ENTRY_CLAIM_ID: entryId,
  GOOGLE_FORM_ENTRY_CLAIMANT: entryId,
  GOOGLE_FORM_ENTRY_LOOKUP: entryId,
  GOOGLE_FORM_ENTRY_DECISION: entryId,
});
const llmShape = {
  LLM_API_KEY: optional,
  LLM_API_BASE_URL: httpUrl.optional(),
  LLM_MODEL: optional,
};
const llmKeys = Object.keys(llmShape) as (keyof typeof llmShape)[];
function checkLlmGroup(value: z.infer<typeof llmSchema>, context: z.RefinementCtx) {
  if (!llmKeys.some((key) => value[key] !== undefined)) return;
  for (const key of llmKeys) {
    if (value[key] === undefined) context.addIssue({ code: "custom", path: [key], message: "is required when any LLM_* variable is set" });
  }
}
const llmSchema = z.object(llmShape);
const optionsSchema = z.object({
  ESCALATION_WEBHOOK_URL: webhookUrl.optional(),
  DAILY_VISION_LIMIT: dailyLimit,
  DAILY_LLM_LIMIT: dailyLimit,
  DEMO_ACCESS_CODE: optional,
  FORM_WEBHOOK_SECRET: optional,
});
const envSchema = z.object({
  ...databaseSchema.shape, ...visionSchema.shape, ...formSchema.shape,
  ...llmShape, ...optionsSchema.shape,
}).superRefine(checkLlmGroup);

export class EnvironmentError extends Error {
  constructor(issues: z.core.$ZodIssue[]) {
    // Never include values: connection strings and keys contain secrets.
    super(`Environment configuration error:\n${issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n")}`);
    this.name = "EnvironmentError";
  }
}

function parse<S extends z.ZodType>(schema: S, source: EnvironmentSource): z.output<S> {
  const normalized = Object.fromEntries(Object.entries(source).map(([key, value]) =>
    [key, value?.trim() || undefined]));
  const result = schema.safeParse(normalized);
  if (!result.success) throw new EnvironmentError(result.error.issues);
  return result.data;
}

/** No environment access or validation occurs until a getter is called. */
export function getEnv(source: EnvironmentSource = process.env) { return parse(envSchema, source); }
export function getMongoEnv(source: EnvironmentSource = process.env) { return parse(databaseSchema, source); }
export function getVisionEnv(source: EnvironmentSource = process.env) { return parse(visionSchema, source); }
export function getFormEnv(source: EnvironmentSource = process.env) { return parse(formSchema, source); }
export function getOptionalEnv(source: EnvironmentSource = process.env) { return parse(optionsSchema, source); }
export function getLlmEnv(source: EnvironmentSource = process.env) {
  const result = parse(llmSchema.superRefine(checkLlmGroup), source);
  if (!result.LLM_API_KEY || !result.LLM_API_BASE_URL || !result.LLM_MODEL) return null;
  return { apiKey: result.LLM_API_KEY, baseUrl: result.LLM_API_BASE_URL, model: result.LLM_MODEL };
}
export type Env = z.infer<typeof envSchema>;
