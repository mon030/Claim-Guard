import type { Db } from "mongodb";
import type { ClaimRecord } from "./models";

export async function resetUserData(db: Db, dryRun = false) {
  const userClaims = await db.collection<ClaimRecord>("claims").find({ origin: "user" }, { projection: { claimId: 1 } }).toArray();
  const claimIds = userClaims.map((claim) => claim.claimId);
  const filters = {
    decisions: { claimId: { $in: claimIds } },
    audit_log: { claimId: { $in: claimIds } },
    photos: { origin: "user" },
    claims: { origin: "user", claimId: { $in: claimIds } },
  };
  const counts: Record<string, number> = {};
  // Delete dependent entries first, and only then remove the captured claims.
  for (const [name, filter] of Object.entries(filters)) {
    counts[name] = dryRun ? await db.collection(name).countDocuments(filter) : (await db.collection(name).deleteMany(filter)).deletedCount;
  }
  return counts;
}
