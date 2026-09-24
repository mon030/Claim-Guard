import { MongoError, MongoNetworkError, MongoOperationTimeoutError, MongoServerSelectionError } from "mongodb";
import pRetry from "p-retry";

export function isMongoFailure(error: unknown): error is MongoError {
  return error instanceof MongoError;
}
export function mongoFailureDetails(error: unknown) {
  const value = error as { name?: string; code?: unknown; message?: string; hasErrorLabel?: (label: string) => boolean };
  const message = value?.message ?? "";
  const code = value?.code;
  const kind = code === 18 || code === 13 || /auth|not authorized/i.test(message) ? "authentication_or_permission" :
    /IP.*(allow|access|reject)|not.*whitelist/i.test(message) ? "network_access_rejected" :
    error instanceof MongoOperationTimeoutError || /timed? ?out|timeout/i.test(message) ? "timeout" :
    error instanceof MongoServerSelectionError ? "server_selection" : error instanceof MongoNetworkError ? "network" : "other";
  // Log type/code/category, not topology, URI, credentials or claim data.
  return { type: value?.name ?? "Unknown", code: typeof code === "number" || typeof code === "string" ? code : null, kind };
}
export function isTransientMongoError(error: unknown): boolean {
  if (!isMongoFailure(error)) return false;
  const { kind } = mongoFailureDetails(error);
  if (kind === "authentication_or_permission" || kind === "network_access_rejected") return false;
  return error instanceof MongoNetworkError || error instanceof MongoServerSelectionError ||
    error instanceof MongoOperationTimeoutError || [6, 7, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436].includes(Number(error.code)) ||
    error.hasErrorLabel("RetryableWriteError") || error.hasErrorLabel("TransientTransactionError");
}

/** Only wrap reads or idempotent writes. Never replay usage increments or external calls. */
export function withMongoRetry<T>(operation: () => Promise<T>, deadline = Date.now() + 9_000): Promise<T> {
  return pRetry(() => {
    if (Date.now() >= deadline) throw new MongoOperationTimeoutError("Request database budget exhausted.");
    return operation();
  }, { retries: 2, minTimeout: 100, maxTimeout: 200, factor: 2,
    shouldRetry: ({ error }) => isTransientMongoError(error) && Date.now() + 1_200 < deadline,
    onFailedAttempt: ({ error, attemptNumber }) => {
      if (isMongoFailure(error)) console.error("ClaimGuard MongoDB failure", JSON.stringify({ ...mongoFailureDetails(error), attempt: attemptNumber }));
    },
  });
}
