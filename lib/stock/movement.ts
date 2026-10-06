import { db, txClient, type Executor } from "@/lib/db";
import { LendedShoes, shoeInventory } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { flagNotifier } from "./notifier";

/**
 * Every way a unit of stock (or its Storage Location) can move. `correction`
 * is the odd one out — it carries the resulting quantity, not a delta, because
 * it comes from a human typing a number into EditInventoryDialog.
 */
export type MovementReason =
  | "sale"
  | "borrower-sale"
  | "cancel"
  | "retour"
  // The Returned Pair of an Échange, once its Delivery Leg is delivered
  // (docs/adr/0009). Moves stock exactly as "retour" does; named apart because
  // the pair it brings back was sold by the Original Order, not by the order
  // it is attributed to.
  | "echange-return"
  | "arrival"
  | "lend"
  | "return";

type QuantityItem = { inventoryId: string; quantity: number };
type CorrectionItem = { inventoryId: string; newQuantity: number };

export type MovementInput =
  | {
      reason: MovementReason;
      items: QuantityItem[];
      borrowerId?: string;
      /** Optional attribution for the notifier queue (see ImageNotifierTable.orderId). */
      orderId?: string;
    }
  | { reason: "correction"; items: CorrectionItem[] };

export type MovementResult = {
  updated: { inventoryId: string; quantity: number }[];
};

// Physical Quantity direction per reason. "lend"/"return" only move Storage
// Location (the LendedShoes ledger) — Physical Quantity, and therefore the
// gallery notifier, never sees them (docs/adr/0003).
const DIRECTION: Record<MovementReason, "increment" | "decrement" | "none"> = {
  sale: "decrement",
  "borrower-sale": "decrement",
  cancel: "increment",
  retour: "increment",
  "echange-return": "increment",
  arrival: "increment",
  lend: "none",
  return: "none",
};

// Sign of the LendedShoes row this reason writes, if any.
const LENDED_SIGN: Partial<Record<MovementReason, 1 | -1>> = {
  "borrower-sale": -1,
  cancel: 1,
  retour: 1,
  "echange-return": 1,
  lend: 1,
  return: -1,
};

// "borrower-sale"/"lend"/"return" make no sense without a borrower. "cancel",
// "retour" and "echange-return" write a LendedShoes row too, but only when the
// order they're reversing happened to be a borrower's — a plain owner order has
// no borrowerId and that's fine, so those don't belong in this set.
const BORROWER_REQUIRED = new Set<MovementReason>([
  "borrower-sale",
  "lend",
  "return",
]);

const FLAGS_NOTIFIER = new Set<MovementReason>([
  "sale",
  "borrower-sale",
  "cancel",
  "retour",
  "echange-return",
  "arrival",
]);

/** Flags the gallery only when Physical Quantity actually crossed the zero boundary. */
async function maybeFlagNotifier(
  exec: typeof db,
  inventoryId: string,
  orderId: string | undefined,
  before: number,
  after: number,
) {
  if (before > 0 && after === 0) {
    await flagNotifier(inventoryId, "remove", orderId, exec);
  } else if (before === 0 && after > 0) {
    await flagNotifier(inventoryId, "restock", orderId, exec);
  }
}

async function readQuantity(exec: typeof db, inventoryId: string): Promise<number> {
  const [row] = await exec
    .select({ quantity: shoeInventory.quantity })
    .from(shoeInventory)
    .where(eq(shoeInventory.id, inventoryId))
    .limit(1);
  return row?.quantity ?? 0;
}

async function runMovement(
  input: MovementInput,
  exec: Executor,
): Promise<MovementResult> {
  const e = exec as typeof db;
  const updated: { inventoryId: string; quantity: number }[] = [];

  if (input.reason === "correction") {
    for (const item of input.items) {
      const before = await readQuantity(e, item.inventoryId);
      const newQuantity = Math.max(0, item.newQuantity);

      const [row] = await e
        .update(shoeInventory)
        .set({ quantity: newQuantity })
        .where(eq(shoeInventory.id, item.inventoryId))
        .returning({ id: shoeInventory.id, quantity: shoeInventory.quantity });

      if (!row) continue;
      updated.push({ inventoryId: row.id, quantity: row.quantity });
      await maybeFlagNotifier(e, row.id, undefined, before, row.quantity);
    }
    return { updated };
  }

  const { reason, items, borrowerId, orderId } = input;
  const direction = DIRECTION[reason];
  const lendedSign = LENDED_SIGN[reason];

  if (BORROWER_REQUIRED.has(reason) && !borrowerId) {
    throw new Error(`Movement reason "${reason}" requires a borrowerId`);
  }

  for (const item of items) {
    const before = await readQuantity(e, item.inventoryId);
    let row: { id: string; quantity: number } | undefined;

    if (direction === "decrement") {
      [row] = await e
        .update(shoeInventory)
        .set({
          quantity: sql`GREATEST(0, ${shoeInventory.quantity} - ${item.quantity})`,
        })
        .where(eq(shoeInventory.id, item.inventoryId))
        .returning({ id: shoeInventory.id, quantity: shoeInventory.quantity });
    } else if (direction === "increment") {
      [row] = await e
        .update(shoeInventory)
        .set({ quantity: sql`${shoeInventory.quantity} + ${item.quantity}` })
        .where(eq(shoeInventory.id, item.inventoryId))
        .returning({ id: shoeInventory.id, quantity: shoeInventory.quantity });
    }

    if (row) updated.push({ inventoryId: row.id, quantity: row.quantity });

    if (lendedSign && borrowerId) {
      await e.insert(LendedShoes).values({
        borrowerId,
        shoeInventoryId: item.inventoryId,
        quantity: lendedSign * item.quantity,
      });
    }

    if (FLAGS_NOTIFIER.has(reason) && row) {
      await maybeFlagNotifier(e, row.id, orderId, before, row.quantity);
    }
  }

  return { updated };
}

/**
 * The single entry point for every Stock Movement — the only code allowed to
 * write shoeInventory.quantity, LendedShoes, or ImageNotifierTable (see
 * docs/adr/0004-all-stock-movement-goes-through-lib-stock.md).
 *
 * Pass `exec` when the caller already holds a transaction (e.g. arrivals,
 * which also writes arrival_items in the same transaction); omit it to have
 * this function open its own `txClient().transaction()`.
 */
export async function applyMovement(
  input: MovementInput,
  exec?: Executor,
): Promise<MovementResult> {
  if (exec) return runMovement(input, exec);
  return txClient().transaction((tx) => runMovement(input, tx));
}
