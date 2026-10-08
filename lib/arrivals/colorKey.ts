/**
 * A colour name as it is stored and shown: trimmed, with runs of whitespace
 * collapsed to one space. The owner's capitalisation is kept.
 */
export function cleanColorName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * The identity of a colour within its model: two names with the same key are
 * the same Product. Shared by the add-shoes form (which offers the existing
 * colour instead of a new one) and by `saveArrival` (which refuses to create
 * the second one whatever the form sent) — there is no unique index on
 * `(model_id, color)`, so this function is the only thing that defines a
 * duplicate. No db imports: the form bundles it.
 */
export function colorKey(name: string): string {
  return cleanColorName(name).toLowerCase();
}
