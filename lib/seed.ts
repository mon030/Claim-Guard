import { readFile } from "node:fs/promises";
import path from "node:path";
import { Binary, type Db } from "mongodb";
import sharp from "sharp";
import { DatasetError, loadDataset, PHOTO_DIR } from "./dataset";
import { fingerprintPhoto, thumbnail } from "./photos";
import { ensureIndexes } from "./mongodb";
import type { ClaimRecord, PhotoRecord } from "./models";

export async function prepareSeed() {
  const dataset = await loadDataset(true);
  const claimForFilename = new Map<string, string>();
  for (const [claimId, filenames] of Object.entries(dataset.mapping)) for (const filename of filenames ?? []) claimForFilename.set(filename, claimId);
  const photos = await Promise.all(dataset.filenames.map(async (filename) => {
    const content = await readFile(path.join(PHOTO_DIR, filename));
    const hashes = await fingerprintPhoto(content);
    if ((await sharp(content).metadata()).format !== "jpeg") throw new DatasetError(`${filename}: reference photos must be JPEG files.`);
    return { filename, claimId: claimForFilename.get(filename) ?? null, ...hashes,
      contentType: "image/jpeg", byteLength: content.length, content: new Binary(content),
      thumbnail: new Binary(await thumbnail(content)), thumbnailContentType: "image/jpeg" as const };
  }));
  return { ...dataset, photos };
}
export async function seedDatabase(db: Db, prepared: Awaited<ReturnType<typeof prepareSeed>>, now = new Date()) {
  await ensureIndexes(db);
  const claims = await db.collection<ClaimRecord>("claims").bulkWrite(prepared.claims.map((claim) => ({ updateOne: {
    filter: { claimId: claim.claimId, origin: "seed" },
    update: { $set: { ...claim, mappedPhotos: prepared.mapping[claim.claimId] }, $setOnInsert: { origin: "seed", createdAt: now }, $unset: { expiresAt: "", mappedFilenames: "" } },
    upsert: true,
  } })), { ordered: true });
  const photos = await db.collection<PhotoRecord>("photos").bulkWrite(prepared.photos.map((photo) => ({ updateOne: {
    filter: { filename: photo.filename, origin: "seed" },
    update: { $set: photo, $setOnInsert: { origin: "seed", createdAt: now }, $unset: { expiresAt: "" } },
    upsert: true,
  } })), { ordered: true });
  return { claimsInserted: claims.upsertedCount, claimsUpdated: claims.modifiedCount, photosInserted: photos.upsertedCount, photosUpdated: photos.modifiedCount };
}
