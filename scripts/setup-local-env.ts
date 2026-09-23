import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";
import { getFormEnv, getMongoEnv, getVisionEnv } from "../lib/env";
import { PROJECT_ROOT, DatasetError } from "../lib/dataset";
import { runCli } from "../lib/cli";

await runCli(async () => {
  const source = await readFile(path.join(PROJECT_ROOT, "env_setup.md"), "utf8");
  const blocks = [...source.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g)].map((match) => match[1].trim());
  const visionKey = blocks.map((block) => block.match(/AIza[\w-]+/)?.[0]).find(Boolean);
  const rawUri = blocks.map((block) => block.match(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/)?.[0]).find(Boolean);
  if (!visionKey || !rawUri) throw new DatasetError("Setup notes need a Vision key and MongoDB connection URI.");
  // MongoDB multi-host URLs are not WHATWG URLs. Escape credentials without
  // parsing or changing the multi-host address and query portion.
  const encodeCredential = (value: string) => {
    try { return encodeURIComponent(decodeURIComponent(value)); }
    catch { return encodeURIComponent(value); }
  };
  const uri = rawUri.replace(/^(mongodb(?:\+srv)?:\/\/)([^:]+):(.+)@([^@]+)$/, (_all, scheme: string, user: string, password: string, hosts: string) =>
    `${scheme}${encodeCredential(user)}:${encodeCredential(password)}@${hosts}`);
  const additions: Record<string, string> = { GOOGLE_VISION_API_KEY: visionKey, MONGODB_URI: uri };
  for (const match of source.matchAll(/\|\s*`(GOOGLE_FORM_[A-Z_]+)`\s*\|\s*`([^`]+)`/g)) additions[match[1]] = match[2];
  const envPath = path.join(PROJECT_ROOT, ".env");
  const current = await readFile(envPath, "utf8");
  const values = parseEnv(current);
  let output = current;
  const updated: string[] = [];
  for (const [key, value] of Object.entries(additions)) {
    if (values[key]?.trim()) continue;
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    output = pattern.test(output) ? output.replace(pattern, () => line) : `${output}\n${line}\n`;
    updated.push(key);
  }
  const merged = parseEnv(output);
  getVisionEnv(merged); getMongoEnv(merged); getFormEnv(merged);
  await writeFile(envPath, output, { encoding: "utf8", mode: 0o600 });
  console.log(`Local .env ready. Added ${updated.length} settings; existing nonempty values preserved.`);
  console.log("Optional LLM remains unchanged: the setup notes do not specify a complete compatible base URL/model configuration.");
});
