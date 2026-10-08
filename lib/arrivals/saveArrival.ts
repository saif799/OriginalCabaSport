import { db, type Executor } from "@/lib/db";
import {
  arrivalItems,
  arrivals,
  shoeInventory,
  shoeModels,
  shoes,
} from "@/lib/schema";
import { generateShortId } from "@/lib/generateId";
import { applyMovement } from "@/lib/stock/movement";
import { and, eq, inArray, or } from "drizzle-orm";
import { cleanColorName, colorKey } from "./colorKey";
import type { ArrivalLine, CreatedColour } from "./form";
import { findMalformedModelIds, findUnknownModelIds } from "./validate";

/** Straight off the request body: validated here, not by the caller. */
export type ArrivalInput = {
  reference?: unknown;
  note?: unknown;
  lines: unknown;
};

export type ArrivalResult = { arrivalId: string; created: CreatedColour[] };

/** The payload is wrong in a way the owner can fix; the message says how. */
export class ArrivalError extends Error {}

function optionalText(raw: unknown): string | null {
  return (typeof raw === "string" && raw.trim()) || null;
}

function parseSizes(raw: unknown): Map<string, number> {
  const sizes = new Map<string, number>();
  if (!Array.isArray(raw)) return sizes;

  for (const entry of raw) {
    const size = typeof entry?.size === "string" ? entry.size.trim() : "";
    const quantity = entry?.quantity;
    if (!size || !Number.isInteger(quantity) || quantity < 1) {
      throw new ArrivalError("Each size needs a quantity of 1 or more");
    }
    sizes.set(size, (sizes.get(size) ?? 0) + quantity);
  }
  return sizes;
}

function parseLines(raw: unknown): { line: ArrivalLine; sizes: Map<string, number> }[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArrivalError("No lines to save");
  }

  return raw.map((line) => {
    const sizes = parseSizes(line?.sizes);
    if (sizes.size === 0) {
      throw new ArrivalError("Each line needs at least one size");
    }

    if (line?.mode === "new") {
      const color = typeof line.color === "string" ? cleanColorName(line.color) : "";
      if (typeof line.modelId !== "string" || !line.modelId || !color) {
        throw new ArrivalError("New shoe lines need a model and color");
      }
      return { line: { ...line, color } as ArrivalLine, sizes };
    }

    if (line?.mode === "existing") {
      if (typeof line.shoeId !== "string" || !line.shoeId) {
        throw new ArrivalError("Existing shoe lines need a shoeId");
      }
      return { line: line as ArrivalLine, sizes };
    }

    throw new ArrivalError("Each line must be a new or an existing colour");
  });
}

/**
 * Saves one arrivage: resolves every line to the Product it lands on, creates
 * the colours and sizes that do not exist yet, and brings every pair in as an
 * `arrival` Stock Movement.
 *
 * Runs entirely on `exec`, reads included, so the caller decides the
 * transaction — `POST /api/arrivals` passes a `txClient()` transaction, and
 * nothing here is safe outside one. All validation happens before the first
 * write.
 */
export async function saveArrival(
  input: ArrivalInput,
  exec: Executor,
): Promise<ArrivalResult> {
  const e = exec as typeof db;
  const parsed = parseLines(input.lines);

  // Guard before writing: a bad modelId is otherwise only caught by Postgres
  // mid-insert, which rolls the whole arrivage back behind a generic 500. Both
  // checks name the offending value so the cause is visible.
  const modelIds = parsed.flatMap(({ line }) =>
    line.mode === "new" ? [line.modelId] : [],
  );
  const malformed = findMalformedModelIds(modelIds);
  if (malformed.length) {
    throw new ArrivalError(
      `Not a valid model id: ${malformed.join(", ")}. Pick the model again — this looks like a shoe id.`,
    );
  }
  const unknown = await findUnknownModelIds(modelIds, exec);
  if (unknown.length) {
    throw new ArrivalError(`Unknown model: ${unknown.join(", ")}`);
  }

  const lineShoeIds = parsed.flatMap(({ line }) =>
    line.mode === "existing" ? [line.shoeId] : [],
  );

  // Every colour a line could land on: the ones named outright, and all the
  // colours of each model a "new" line names — archived included, since an
  // archived colour is still the same Product.
  const knownShoes =
    modelIds.length || lineShoeIds.length
      ? await e
          .select({ id: shoes.id, modelId: shoes.modelId, color: shoes.color })
          .from(shoes)
          .where(
            or(
              modelIds.length ? inArray(shoes.modelId, modelIds) : undefined,
              lineShoeIds.length ? inArray(shoes.id, lineShoeIds) : undefined,
            ),
          )
          .orderBy(shoes.id)
      : [];
  const shoeById = new Map(knownShoes.map((s) => [s.id, s]));

  const missing = lineShoeIds.filter((id) => !shoeById.has(id));
  if (missing.length) {
    throw new ArrivalError(
      `Unknown shoe: ${Array.from(new Set(missing)).join(", ")}. It may have been deleted — remove the line and add it again.`,
    );
  }

  const models = modelIds.length
    ? await e
        .select({ id: shoeModels.id, modelName: shoeModels.modelName })
        .from(shoeModels)
        .where(inArray(shoeModels.id, modelIds))
    : [];
  const modelById = new Map(models.map((m) => [m.id, m]));

  // The duplicate guard. There is no unique index on (model_id, color), so a
  // colour's identity within its model is its colorKey and nothing else. Where
  // the table already holds two colours with one key (merging them is out of
  // scope here), the first by id takes the pairs — arbitrary, but stable.
  const identity = (modelId: string, color: string) =>
    `${modelId}|${colorKey(color)}`;
  const shoeIdByIdentity = new Map<string, string>();
  for (const shoe of knownShoes) {
    const key = identity(shoe.modelId, shoe.color);
    if (!shoeIdByIdentity.has(key)) shoeIdByIdentity.set(key, shoe.id);
  }

  // One entry per Product the arrivage lands on, however many lines named it:
  // a colour staged twice is one Product receiving the sum.
  const received = new Map<string, Map<string, number>>();
  const shoeInserts: { id: string; modelId: string; color: string }[] = [];
  const created: CreatedColour[] = [];

  for (const { line, sizes } of parsed) {
    let shoeId: string;
    if (line.mode === "existing") {
      shoeId = line.shoeId;
    } else {
      const key = identity(line.modelId, line.color);
      const known = shoeIdByIdentity.get(key);
      if (known) {
        shoeId = known;
      } else {
        shoeId = generateShortId();
        shoeIdByIdentity.set(key, shoeId);
        shoeInserts.push({ id: shoeId, modelId: line.modelId, color: line.color });
        created.push({
          shoeId,
          modelName: modelById.get(line.modelId)!.modelName,
          color: line.color,
        });
      }
    }

    const total = received.get(shoeId) ?? new Map<string, number>();
    for (const [size, quantity] of sizes) {
      total.set(size, (total.get(size) ?? 0) + quantity);
    }
    received.set(shoeId, total);
  }

  const restockedShoeIds = Array.from(received.keys()).filter((id) =>
    shoeById.has(id),
  );
  const existingSizes = restockedShoeIds.length
    ? await e
        .select({
          id: shoeInventory.id,
          shoeId: shoeInventory.shoeId,
          size: shoeInventory.size,
        })
        .from(shoeInventory)
        .where(inArray(shoeInventory.shoeId, restockedShoeIds))
    : [];
  const inventoryIdBySize = new Map(
    existingSizes.map((row) => [`${row.shoeId}|${row.size}`, row.id]),
  );

  // New sizes are inserted empty and then filled by the same arrival movement
  // as everything else, so the Movement Ledger records them.
  const inventoryInserts: { id: string; shoeId: string; size: string; quantity: 0 }[] = [];
  const movementItems: { inventoryId: string; quantity: number; created?: true }[] = [];

  for (const [shoeId, sizes] of received) {
    for (const [size, quantity] of sizes) {
      const existingId = inventoryIdBySize.get(`${shoeId}|${size}`);
      if (existingId) {
        movementItems.push({ inventoryId: existingId, quantity });
      } else {
        const inventoryId = crypto.randomUUID();
        inventoryInserts.push({ id: inventoryId, shoeId, size, quantity: 0 });
        movementItems.push({ inventoryId, quantity, created: true });
      }
    }
  }

  const arrivalId = crypto.randomUUID();

  // Order matters: parents (arrival, shoes, inventory) before children
  // (arrival_items). All ids are pre-generated so children can reference
  // freshly-inserted rows. Every pair goes in through applyMovement, so the
  // ledger row and the restock notifier flag land with the stock change. A
  // size this arrivage created is marked `created`: recorded, but never
  // flagged as a restock.
  await e.insert(arrivals).values({
    id: arrivalId,
    reference: optionalText(input.reference),
    note: optionalText(input.note),
  });
  if (shoeInserts.length) await e.insert(shoes).values(shoeInserts);

  // Receiving stock for something archived brings it back: an archived colour
  // would otherwise take the pairs and stay invisible, and so would any colour
  // of an archived model.
  if (restockedShoeIds.length) {
    await e
      .update(shoes)
      .set({ archived: false })
      .where(and(inArray(shoes.id, restockedShoeIds), eq(shoes.archived, true)));
  }
  const receivingModelIds = Array.from(
    new Set([
      ...modelIds,
      ...restockedShoeIds.map((id) => shoeById.get(id)!.modelId),
    ]),
  );
  await e
    .update(shoeModels)
    .set({ archived: false })
    .where(
      and(inArray(shoeModels.id, receivingModelIds), eq(shoeModels.archived, true)),
    );

  if (inventoryInserts.length) await e.insert(shoeInventory).values(inventoryInserts);

  await applyMovement({ reason: "arrival", arrivalId, items: movementItems }, exec);

  await e.insert(arrivalItems).values(
    movementItems.map((item) => ({
      arrivalId,
      shoeInventoryId: item.inventoryId,
      quantity: item.quantity,
    })),
  );

  return { arrivalId, created };
}
