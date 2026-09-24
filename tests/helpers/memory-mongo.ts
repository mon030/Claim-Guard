import { ObjectId } from "mongodb";
import type { CollectionModels } from "../../lib/models";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value as Row;
const equals = (a: unknown, b: unknown): boolean => a instanceof ObjectId && b instanceof ObjectId ? a.equals(b) : a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
function matches(document: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return (value as Row[]).some((branch) => matches(document, branch));
    const actual = document[key];
    if (value && typeof value === "object" && !(value instanceof ObjectId) && !(value instanceof Date)) {
      return Object.entries(row(value)).every(([operator, operand]) => {
        if (operator === "$in") return (operand as unknown[]).some((entry) => equals(actual, entry));
        if (operator === "$ne") return !equals(actual, operand);
        if (operator === "$gt") return (actual as number) > (operand as number);
        if (operator === "$lt") return (actual as number) < (operand as number);
        throw new Error(`Unsupported test filter operator: ${operator}`);
      });
    }
    return equals(actual, value);
  });
}
function project(document: Row, options: { projection?: Record<string, number> } = {}): Row {
  const projection = options.projection;
  if (!projection) return { ...document };
  if (Object.values(projection).includes(1)) return Object.fromEntries(Object.entries(document).filter(([key]) => key === "_id" || projection[key] === 1));
  return Object.fromEntries(Object.entries(document).filter(([key]) => projection[key] !== 0));
}

/** Only the driver operations used by these routes; unsupported filters fail loudly. */
export class MemoryCollection<T extends object> {
  documents: (T & { _id: ObjectId })[] = [];
  async findOne(filter: Row, options = {}): Promise<(T & { _id: ObjectId }) | null> {
    const found = this.documents.find((document) => matches(row(document), filter));
    return found ? project(row(found), options) as T & { _id: ObjectId } : null;
  }
  find(filter: Row, options = {}) {
    return { toArray: async () => this.documents.filter((document) => matches(row(document), filter)).map((document) => project(row(document), options) as T & { _id: ObjectId }) };
  }
  async insertOne(document: T) {
    const saved = { ...document, _id: row(document)._id as ObjectId ?? new ObjectId() };
    this.documents.push(saved);
    return { insertedId: saved._id };
  }
  async insertMany(documents: T[]) {
    for (const document of documents) await this.insertOne(document);
    return { insertedCount: documents.length };
  }
  private update(filter: Row, update: Row, options: { upsert?: boolean }) {
    let found = this.documents.find((document) => matches(row(document), filter));
    const inserted = !found;
    if (!found && !options.upsert) return null;
    if (!found) {
      found = { ...filter, _id: filter._id instanceof ObjectId ? filter._id : new ObjectId() } as T & { _id: ObjectId };
      this.documents.push(found);
    }
    if (inserted && update.$setOnInsert) Object.assign(found, update.$setOnInsert);
    if (update.$set) Object.assign(found, update.$set);
    for (const [key, increment] of Object.entries(row(update.$inc ?? {}))) row(found)[key] = Number(row(found)[key] ?? 0) + Number(increment);
    for (const key of Object.keys(row(update.$unset ?? {}))) delete row(found)[key];
    return { found, inserted };
  }
  async updateOne(filter: Row, update: Row, options = {}) {
    const result = this.update(filter, update, options);
    return { matchedCount: result && !result.inserted ? 1 : 0, modifiedCount: result ? 1 : 0, upsertedCount: result?.inserted ? 1 : 0 };
  }
  async findOneAndUpdate(filter: Row, update: Row, options = {}) {
    const result = this.update(filter, update, options);
    return result ? { ...result.found } : null;
  }
}
export function memoryCollections() {
  return {
    claims: new MemoryCollection<CollectionModels["claims"]>(),
    photos: new MemoryCollection<CollectionModels["photos"]>(),
    vision_cache: new MemoryCollection<CollectionModels["vision_cache"]>(),
    decisions: new MemoryCollection<CollectionModels["decisions"]>(),
    audit_log: new MemoryCollection<CollectionModels["audit_log"]>(),
    usage: new MemoryCollection<CollectionModels["usage"]>(),
  };
}
