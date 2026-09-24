import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoNetworkError, MongoOperationTimeoutError, MongoServerError } from "mongodb";
import { isTransientMongoError, mongoFailureDetails, withMongoRetry } from "./mongo-retry";
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.useRealTimers());
describe("bounded database retries", () => {
  it("recovers after two transient failures, with short exponential backoff", async () => {
    const work = vi.fn().mockRejectedValueOnce(new MongoNetworkError("offline")).mockRejectedValueOnce(new MongoOperationTimeoutError("timeout")).mockResolvedValue("saved");
    const pending = withMongoRetry(work);
    await vi.advanceTimersByTimeAsync(99); expect(work).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(work).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); expect(await pending).toBe("saved"); expect(work).toHaveBeenCalledTimes(3);
  });
  it("stops at three total attempts", async () => {
    const work = vi.fn().mockRejectedValue(new MongoNetworkError("offline"));
    const pending = expect(withMongoRetry(work)).rejects.toThrow("offline");
    await vi.runAllTimersAsync(); await pending; expect(work).toHaveBeenCalledTimes(3);
  });
  it("does not retry auth, duplicate key, validation or exhausted request budget", async () => {
    for (const error of [new MongoServerError({ code: 18, message: "Authentication failed" }), new MongoServerError({ code: 11000, message: "duplicate" }), new Error("invalid")]) {
      const work = vi.fn().mockRejectedValue(error); await expect(withMongoRetry(work)).rejects.toBe(error); expect(work).toHaveBeenCalledTimes(1);
    }
    const work = vi.fn().mockRejectedValue(new MongoNetworkError("offline"));
    await expect(withMongoRetry(work, Date.now())).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
  });
  it("logs categories and codes, never raw credentials", () => {
    expect(mongoFailureDetails(new MongoServerError({ code: 18, message: "mongodb://secret" }))).toMatchObject({ code: 18, kind: "authentication_or_permission" });
    expect(mongoFailureDetails(new MongoOperationTimeoutError("secret"))).toMatchObject({ kind: "timeout" });
    expect(isTransientMongoError(new MongoServerError({ code: 91, message: "shutdown" }))).toBe(true);
    expect(JSON.stringify(mongoFailureDetails(new MongoNetworkError("mongodb://secret")))).not.toContain("secret");
  });
});
