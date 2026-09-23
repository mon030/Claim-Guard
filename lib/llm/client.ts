import { z } from "zod";
import { getLlmEnv } from "../env";

export const LLM_TIMEOUT_MS = 8_000;
export type LlmPurpose = "extract_claim_identity" | "narrative_similarity" | "adjuster_explanation";
export interface ChatMessage { role: "system" | "user"; content: string; }

const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
  })).min(1),
});

/**
 * Sole provider boundary. Uses widely supported JSON-object mode and validates
 * the actual output locally. Never exposes tools, photos, or decision authority.
 * Absent configuration and provider/output failures return null for fallback.
 * A partial/malformed environment is a readable configuration error, not absence.
 */
export async function requestStructuredJson<S extends z.ZodType>(request: {
  purpose: LlmPurpose;
  messages: readonly ChatMessage[];
  schema: S;
}): Promise<z.output<S> | null> {
  const config = getLlmEnv();
  if (!config) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const completion = completionSchema.safeParse(await response.json());
    if (!completion.success || controller.signal.aborted) return null;
    const choice = completion.data.choices[0];
    if (choice.finish_reason !== "stop" || choice.message.refusal || !choice.message.content) return null;
    const parsed = request.schema.safeParse(JSON.parse(choice.message.content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
