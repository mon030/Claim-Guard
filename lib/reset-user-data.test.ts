import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { resetUserData } from "./reset-user-data";
function fakeDb(ids: string[]) {
  const events: string[] = [];
  const find = vi.fn().mockImplementation(() => ({ toArray: async () => { events.push("capture-user-ids"); return ids.map((claimId) => ({ claimId })); } }));
  const deletes = Object.fromEntries(["claims", "photos", "decisions", "audit_log"].map((name) => [name, vi.fn().mockImplementation(async () => { events.push(name); return { deletedCount: 2 }; })]));
  const collection = vi.fn().mockImplementation((name: string) => {
    if (!(name in deletes)) throw new Error("Protected collection was accessed");
    return { find, deleteMany: deletes[name], countDocuments: vi.fn().mockResolvedValue(2) };
  });
  return { db: { collection } as unknown as Db, collection, find, deletes, events };
}
describe("demo reset", () => {
  it("captures user claims before deletion and restricts dependent entries to those IDs", async () => {
    const mock = fakeDb(["USER-1"]);
    expect(await resetUserData(mock.db)).toEqual({ decisions: 2, audit_log: 2, photos: 2, claims: 2 });
    expect(mock.find).toHaveBeenCalledWith({ origin: "user" }, { projection: { claimId: 1 } });
    expect(mock.deletes.decisions).toHaveBeenCalledWith({ claimId: { $in: ["USER-1"] } });
    expect(mock.deletes.audit_log).toHaveBeenCalledWith({ claimId: { $in: ["USER-1"] } });
    expect(mock.deletes.photos).toHaveBeenCalledWith({ origin: "user" });
    expect(mock.deletes.claims).toHaveBeenCalledWith({ origin: "user", claimId: { $in: ["USER-1"] } });
    expect(mock.events).toEqual(["capture-user-ids", "decisions", "audit_log", "photos", "claims"]);
  });
  it("does not widen deletion when no user claims exist", async () => {
    const mock = fakeDb([]); await resetUserData(mock.db);
    expect(mock.deletes.decisions).toHaveBeenCalledWith({ claimId: { $in: [] } });
    expect(mock.collection).not.toHaveBeenCalledWith("vision_cache"); expect(mock.collection).not.toHaveBeenCalledWith("usage");
  });
  it("supports a non-mutating dry run", async () => {
    const mock = fakeDb(["USER-1"]); await resetUserData(mock.db, true);
    for (const deleteMany of Object.values(mock.deletes)) expect(deleteMany).not.toHaveBeenCalled();
  });
});
