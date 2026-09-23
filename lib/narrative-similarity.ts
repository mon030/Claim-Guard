/** A fixed, small list; negations and numbers intentionally remain meaningful. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "from",
  "with", "as", "by", "is", "was", "were", "be", "been", "it", "its", "my", "me", "i",
]);

export function tokenizeNarrative(text: string): Set<string> {
  const words = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

/** Token-set Jaccard in [0,1]. Empty text is absence of evidence, not a match. */
export function narrativeSimilarity(a: string, b: string): number {
  const left = tokenizeNarrative(a);
  const right = tokenizeNarrative(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}
