import { EnvironmentError } from "./env";
import { VisionError } from "./vision";

export class DatasetError extends Error {
  constructor(message: string) { super(message); this.name = "DatasetError"; }
}
/** Shared sanitization without importing any CLI filesystem/dataset-loading code into routes. */
export function safeError(error: unknown): string {
  if (error instanceof EnvironmentError || error instanceof DatasetError || error instanceof VisionError) return error.message;
  if (error && typeof error === "object" && "code" in error && (error.code === 18 || error.code === 8000)) {
    return "Atlas rejected the database login. Update MONGODB_URI in local .env using the current Atlas database-user credentials (not a model API key), with a URI-encoded password.";
  }
  return "Operation failed. Check your local credentials, Atlas database user/IP access, connectivity, and file permissions. No credentials were printed.";
}
