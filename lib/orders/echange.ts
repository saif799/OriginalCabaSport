import { db, txClient, type Executor } from "@/lib/db";
import {
  echangeReturns,
  orderItems,
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
} from "@/lib/schema";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { applyMovement } from "@/lib/stock/movement";
import { resolveProductPrice } from "@/lib/helpers";
import { fetchDhdTrackingStatuses } from "@/lib/delivery/dhdTrackings";
import type { ProviderStatus } from "@/lib/delivery/types";
import {
  PersistRejected,
  placeParcel,
  type OrderDraft,
  type PlaceOrderDeps,
  type PlaceOrderResult,
} from "@/lib/orders/placeOrder";
import { ECHANGE_TYPE } from "@/lib/orders/orderType";
import {
  CANCELED_STATUS_ID,
  DELIVERED_STATUS_ID,
  RETURNED_STATUS_ID,
} from "@/lib/orders/status";

/**
 * What the "Échanger" dialog posts: the Original Order and which of its lines
 * come back, the Outgoing Pairs, and the customer fields (prefilled from the
 * Original Order, but the customer may have moved).
 */
export type EchangeDraft = Pick<
  OrderDraft,
  | "nom_client"
  | "telephone"
  | "telephone_2"
  | "adresse"
  | "commune"
  | "code_wilaya"
  | "stop_desk"
  | "montant"
  | "remarque"
> & {
  originalOrderId: string;
  /** Original Order lines coming back, and how many pairs of each: the Returned Pairs. */
  returns: { orderItemId: string; quantity: number }[];
  /** `shoeInventory` ids of the Outgoing Pairs; repeat an id to send two of it. */
  outgoing: string[];
};

function reject(status: number, error: string): PlaceOrderResult {
  return { ok: false, status, error };
}

const ALREADY_EXCHANGED = "One of these pairs has already been exchanged.";

/** Pairs of each Original Order line already taken back by an Échange, by `order_items.id`. */
async function returnedByLine(
  exec: Executor,
  orderItemIds: string[],
): Promise<Map<string, number>> {
  if (orderItemIds.length === 0) return new Map();
  const rows = await (exec as typeof db)
    .select({
      orderItemId: echangeReturns.orderItemId,
      returned: sql<number>`SUM(${echangeReturns.quantity})`.mapWith(Number),
    })
    .from(echangeReturns)
    .where(inArray(echangeReturns.orderItemId, orderItemIds))
    .groupBy(echangeReturns.orderItemId);
  return new Map(rows.map((r) => [r.orderItemId, r.returned]));
}

/** True if taking `returns` back would exchange some pair a second time. */
function exceedsLines(
  returns: { orderItemId: string; quantity: number }[],
  lineQuantity: Map<string, number>,
  returned: Map<string, number>,
): boolean {
  return returns.some(
    (r) =>
      r.quantity + (returned.get(r.orderItemId) ?? 0) >
      (lineQuantity.get(r.orderItemId) ?? 0),
  );
}

/** "Air Force 1 White 42" for each inventory id, keyed by id. */
async function variantLabels(exec: Executor, inventoryIds: string[]) {
  if (inventoryIds.length === 0) return new Map<string, string>();
  const rows = await (exec as typeof db)
    .select({
      id: shoeInventory.id,
      modelName: shoeModels.modelName,
      color: shoes.color,
      size: shoeInventory.size,
    })
    .from(shoeInventory)
    .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .where(inArray(shoeInventory.id, inventoryIds));
  return new Map(rows.map((r) => [r.id, `${r.modelName} ${r.color} ${r.size}`]));
}

/**
 * Starts an Échange from its Original Order (see ADR-0009): sends the Outgoing
 * Pairs through DHD as a `type = 2` order, and records which Original Order
 * lines come back. Stock moves exactly as for a sale — the Outgoing Pairs
 * leave Physical Quantity now; the Returned Pairs only re-enter it when the
 * status sync sees the Delivery Leg delivered.
 */
export async function placeEchange(
  draft: EchangeDraft,
  deps: PlaceOrderDeps = {},
): Promise<PlaceOrderResult> {
  const readExec = (deps.exec ?? db) as typeof db;
  const { originalOrderId, outgoing } = draft;

  // One link per line: the same line ticked twice is one return of both.
  const quantityByLine = new Map<string, number>();
  for (const r of draft.returns ?? []) {
    if (!Number.isInteger(r.quantity) || r.quantity < 1) {
      return reject(400, "Each returned line needs a whole number of pairs.");
    }
    quantityByLine.set(r.orderItemId, (quantityByLine.get(r.orderItemId) ?? 0) + r.quantity);
  }
  const returns = Array.from(quantityByLine, ([orderItemId, quantity]) => ({
    orderItemId,
    quantity,
  }));
  if (returns.length === 0) {
    return reject(400, "Tick at least one pair the customer is giving back.");
  }
  if (!outgoing?.length) {
    return reject(400, "Pick at least one pair to send.");
  }
  // The price difference, floored at 0 by the dialog: a refund on a cheaper
  // swap happens outside the app, never as a negative montant.
  if (!/^\d+$/.test(draft.montant ?? "")) {
    return reject(400, "Montant must be a whole number of DA, 0 or more.");
  }

  const [original] = await readExec
    .select({
      id: ordersTable.id,
      source: ordersTable.source,
      provider: ordersTable.provider,
      statusId: ordersTable.statusId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, originalOrderId))
    .limit(1);
  if (!original) return reject(404, "Original Order not found.");
  if (original.provider !== "dhd") {
    return reject(400, "Only DHD carries Échanges.");
  }
  // The customer has to have the pair before they can hand it back.
  if (original.statusId !== DELIVERED_STATUS_ID) {
    return reject(400, "Only a delivered order can be exchanged.");
  }

  const lines = await readExec
    .select({
      id: orderItems.id,
      inventoryId: orderItems.shoeInventoryId,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, originalOrderId));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  if (returns.some((r) => !lineById.has(r.orderItemId))) {
    return reject(400, "A returned pair is not on the Original Order.");
  }

  // Checked here so a refusal never reaches the courier, and again under a
  // row lock inside the write, where it actually holds.
  const lineQuantity = new Map(lines.map((l) => [l.id, l.quantity]));
  const returnedIds = returns.map((r) => r.orderItemId);
  if (exceedsLines(returns, lineQuantity, await returnedByLine(readExec, returnedIds))) {
    return reject(409, ALREADY_EXCHANGED);
  }

  const labels = await variantLabels(readExec, [
    ...outgoing,
    ...returns.map((r) => lineById.get(r.orderItemId)?.inventoryId ?? ""),
  ]);
  const outgoingLabels = outgoing.map((id) => labels.get(id) ?? "?");
  const returnedLabels = returns.map(
    (r) => labels.get(lineById.get(r.orderItemId)?.inventoryId ?? "") ?? "?",
  );

  return placeParcel(
    {
      nom_client: draft.nom_client,
      telephone: draft.telephone,
      telephone_2: draft.telephone_2,
      adresse: draft.adresse,
      commune: draft.commune,
      code_wilaya: draft.code_wilaya,
      stop_desk: draft.stop_desk,
      montant: draft.montant,
      remarque: draft.remarque,
      // What the livreur reads on the parcel: what to hand over, what to take back.
      produit: `Echange: ${outgoingLabels.join(", ")} contre ${returnedLabels.join(", ")}`,
      type: ECHANGE_TYPE,
      source: original.source,
      selectedSizeShoeId: outgoing,
      // Only DHD carries Échanges, and the Outgoing Pairs are the owner's.
      provider: "dhd",
      borrowerId: null,
    },
    deps,
    async (exec, echangeId) => {
      const e = exec as typeof db;
      // Two Échanges of the same pair racing each other both pass the check
      // above; locking the lines serialises them, so the second sees the first.
      await e
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(inArray(orderItems.id, returnedIds))
        .for("update");
      if (exceedsLines(returns, lineQuantity, await returnedByLine(e, returnedIds))) {
        throw new PersistRejected(409, ALREADY_EXCHANGED);
      }

      await e.insert(echangeReturns).values(
        returns.map((r) => ({
          echangeId,
          orderItemId: r.orderItemId,
          quantity: r.quantity,
        })),
      );
    },
  );
}

export type EchangeLinks = {
  /** Échanges that took pairs of this order back — it is their Original Order. */
  echangeIds: string[];
  /** This order's Original Order, when it is a linked Échange. */
  originalOrderId: string | null;
  /** Pairs on this order that no Échange has taken back yet. */
  exchangeablePairs: number;
};

/** How each of `orderIds` sits in an Échange, for the orders table. */
export async function getEchangeLinks(
  orderIds: string[],
  exec: Executor = db,
): Promise<Record<string, EchangeLinks>> {
  if (orderIds.length === 0) return {};
  const e = exec as typeof db;

  const [links, lines] = await Promise.all([
    e
      .select({
        echangeId: echangeReturns.echangeId,
        originalOrderId: orderItems.orderId,
        quantity: echangeReturns.quantity,
      })
      .from(echangeReturns)
      .innerJoin(orderItems, eq(echangeReturns.orderItemId, orderItems.id))
      .where(
        or(
          inArray(echangeReturns.echangeId, orderIds),
          inArray(orderItems.orderId, orderIds),
        ),
      ),
    e
      .select({ orderId: orderItems.orderId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds)),
  ]);

  const byOrder: Record<string, EchangeLinks> = {};
  for (const id of orderIds) {
    byOrder[id] = { echangeIds: [], originalOrderId: null, exchangeablePairs: 0 };
  }
  for (const line of lines) byOrder[line.orderId].exchangeablePairs += line.quantity;
  for (const link of links) {
    const original = byOrder[link.originalOrderId];
    if (original) {
      original.exchangeablePairs -= link.quantity;
      if (!original.echangeIds.includes(link.echangeId)) {
        original.echangeIds.push(link.echangeId);
      }
    }
    const echange = byOrder[link.echangeId];
    if (echange) echange.originalOrderId = link.originalOrderId;
  }
  return byOrder;
}

/** What the "Échanger" dialog needs beyond the order row it was opened from. */
export type EchangeStart = {
  /** The Original Order's lines, with what is left to exchange on each. */
  lines: {
    orderItemId: string;
    label: string;
    quantity: number;
    exchangeable: number;
    /** Current resolved price (ADR-0002) — the order keeps no per-line price. */
    price: number;
  }[];
  /** Every variant with a pair in stock, for the Outgoing Pairs. */
  products: {
    shoeId: string;
    label: string;
    sizes: { inventoryId: string; size: string; quantity: number; price: number }[];
  }[];
};

export async function getEchangeStart(
  originalOrderId: string,
  exec: Executor = db,
): Promise<EchangeStart> {
  const e = exec as typeof db;
  const variant = {
    inventoryId: shoeInventory.id,
    shoeId: shoes.id,
    modelName: shoeModels.modelName,
    color: shoes.color,
    size: shoeInventory.size,
    quantity: shoeInventory.quantity,
    basePrice: shoeModels.basePrice,
    shoePriceOverride: shoes.priceOverride,
    sizePriceOverride: shoeInventory.priceOverride,
  };
  const priceOf = (r: {
    basePrice: number;
    shoePriceOverride: number | null;
    sizePriceOverride: number | null;
  }) => resolveProductPrice(r.basePrice, r.shoePriceOverride, r.sizePriceOverride);

  const [lineRows, stockRows] = await Promise.all([
    e
      .select({ ...variant, orderItemId: orderItems.id, lineQuantity: orderItems.quantity })
      .from(orderItems)
      .innerJoin(shoeInventory, eq(orderItems.shoeInventoryId, shoeInventory.id))
      .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
      .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
      .where(eq(orderItems.orderId, originalOrderId)),
    e
      .select(variant)
      .from(shoeInventory)
      .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
      .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
      .where(gt(shoeInventory.quantity, 0))
      .orderBy(asc(shoeModels.modelName), asc(shoes.color), asc(shoeInventory.size)),
  ]);

  const returned = await returnedByLine(
    e,
    lineRows.map((r) => r.orderItemId),
  );

  const products = new Map<string, EchangeStart["products"][number]>();
  for (const r of stockRows) {
    let product = products.get(r.shoeId);
    if (!product) {
      product = { shoeId: r.shoeId, label: `${r.modelName} ${r.color}`, sizes: [] };
      products.set(r.shoeId, product);
    }
    product.sizes.push({
      inventoryId: r.inventoryId,
      size: r.size,
      quantity: r.quantity,
      price: priceOf(r),
    });
  }

  return {
    lines: lineRows.map((r) => ({
      orderItemId: r.orderItemId,
      label: `${r.modelName} ${r.color} ${r.size}`,
      quantity: r.lineQuantity,
      exchangeable: r.lineQuantity - (returned.get(r.orderItemId) ?? 0),
      price: priceOf(r),
    })),
    products: Array.from(products.values()),
  };
}

/**
 * Which orders the status sync may move to `statusId` on their own tracking's
 * word. Every order but an Échange. An undecided Échange only through
 * in-flight statuses: delivered and returned are `resolveEchanges`' to decide,
 * from the Delivery Leg — an Échange its own tracking had already settled
 * would drop out of the sync before its Returned Pairs came back. A decided
 * Échange takes nothing from it at all, since it keeps reporting a return for
 * days after the swap.
 */
export function takesStatusFromOwnTracking(statusId: string): SQL {
  const notEchange = ne(ordersTable.type, ECHANGE_TYPE);
  if (statusId === DELIVERED_STATUS_ID || statusId === RETURNED_STATUS_ID) {
    return notEchange;
  }
  return or(notEchange, isNull(ordersTable.echangeResolvedAt))!;
}

/** DHD's Delivery Leg of an Échange is its own tracking with this suffix. */
export const DELIVERY_LEG_SUFFIX = "-EXCH";

/**
 * How long the Return Leg must sit in a return status with no Delivery Leg
 * before the Échange counts as refused. DHD writes the two legs separately, so
 * a sync landing between the writes must not read a swap as a refusal.
 */
const REFUSAL_GUARD_MS = 24 * 60 * 60 * 1000;

export type EchangeResolution = {
  /** Swapped: the Delivery Leg is delivered. */
  delivered: string[];
  /** Refused: no Delivery Leg, 24h after the Return Leg went back. */
  refused: string[];
  /** Still undecided; asked about again next sync. */
  pending: string[];
};

export type ResolveEchangesDeps = {
  /** Looks Delivery Legs up by tracking. Defaults to DHD's trackings/info; tests pass a fake. */
  fetchLegStatuses?: (trackings: string[]) => Promise<ProviderStatus[]>;
  /** Defaults to `db`, with a transaction per Échange decided; tests pass a test-db handle. */
  exec?: Executor;
  now?: Date;
};

/**
 * Decides the Échanges whose own tracking — the Return Leg — has gone to a
 * return status, from their Delivery Leg (ADR-0009). Called by the status
 * sync, which never applies an Échange's own return status itself.
 *
 * - **Delivery Leg delivered** → the swap happened: the Échange is delivered
 *   and its Returned Pairs re-enter stock (`echange-return`). The Original
 *   Order stays delivered.
 * - **No Delivery Leg, 24h after the Return Leg was first seen returning** → a
 *   Refused Échange: an ordinary `retour` of its Outgoing Pairs.
 * - **Otherwise** → left for the next sync.
 *
 * A Legacy Échange (no link to an Original Order) is decided the same way but
 * only ever gets a status: its stock was reconciled by hand. A decided Échange
 * is never looked at again.
 *
 * @param returning order ids the providers report in a return status this sync.
 */
export async function resolveEchanges(
  returning: string[],
  deps: ResolveEchangesDeps = {},
): Promise<EchangeResolution> {
  const exec = (deps.exec ?? db) as typeof db;
  const now = deps.now ?? new Date();
  const fetchLegStatuses = deps.fetchLegStatuses ?? fetchDhdTrackingStatuses;
  const resolution: EchangeResolution = { delivered: [], refused: [], pending: [] };

  const undecided = and(
    eq(ordersTable.type, ECHANGE_TYPE),
    eq(ordersTable.provider, "dhd"),
    isNull(ordersTable.echangeResolvedAt),
    ne(ordersTable.statusId, CANCELED_STATUS_ID),
  );

  if (returning.length > 0) {
    // Starts the refusal guard's clock, once.
    await exec
      .update(ordersTable)
      .set({ returnLegSeenAt: now })
      .where(
        and(
          undecided,
          inArray(ordersTable.id, returning),
          isNull(ordersTable.returnLegSeenAt),
        ),
      );
  }

  // Everything ever seen returning, not only what was reported this time: a
  // Return Leg can settle and drop off get/orders before its 24h are up.
  const candidates = await exec
    .select({
      id: ordersTable.id,
      borrowerId: ordersTable.borrowerId,
      returnLegSeenAt: ordersTable.returnLegSeenAt,
    })
    .from(ordersTable)
    .where(and(undecided, isNotNull(ordersTable.returnLegSeenAt)));
  if (candidates.length === 0) return resolution;

  let legs: ProviderStatus[];
  try {
    legs = await fetchLegStatuses(candidates.map((c) => c.id + DELIVERY_LEG_SUFFIX));
  } catch (error) {
    // Never read "DHD did not answer" as "no Delivery Leg": that is a refusal.
    console.log("Échange Delivery Leg lookup failed", error);
    resolution.pending = candidates.map((c) => c.id);
    return resolution;
  }
  const legStatus = new Map(legs.map((l) => [l.tracking, l.status]));
  const groups = await exec.select().from(stautsGroupsTable);
  const unmapped = new Set<string>();

  for (const echange of candidates) {
    const status = legStatus.get(echange.id + DELIVERY_LEG_SUFFIX);
    let decided = false;

    if (status !== undefined) {
      // Present but not (yet) delivered decides nothing either way.
      const group = groups.find((g) => g.external_statuses.includes(status));
      if (!group) unmapped.add(status);
      if (group?.id === DELIVERED_STATUS_ID) {
        decided = await inTransaction(deps.exec, (tx) => completeSwap(tx, echange.id, now));
        if (decided) resolution.delivered.push(echange.id);
      }
    } else if (now.getTime() - echange.returnLegSeenAt!.getTime() >= REFUSAL_GUARD_MS) {
      decided = await inTransaction(deps.exec, (tx) =>
        refuse(tx, echange.id, echange.borrowerId, now),
      );
      if (decided) resolution.refused.push(echange.id);
    }

    if (!decided) resolution.pending.push(echange.id);
  }

  if (unmapped.size > 0) {
    console.log("Delivery Leg statuses not in status_groups_table:", [...unmapped]);
  }
  return resolution;
}

function inTransaction<T>(
  exec: Executor | undefined,
  write: (tx: Executor) => Promise<T>,
): Promise<T> {
  return exec ? write(exec) : txClient().transaction((tx) => write(tx));
}

/**
 * Marks the Échange decided with `statusId`, unless a sync running alongside
 * already did. The claim and the movement share a transaction, so whichever
 * sync claims it is the only one that moves stock.
 */
async function claim(
  exec: Executor,
  echangeId: string,
  statusId: string,
  now: Date,
): Promise<boolean> {
  const claimed = await (exec as typeof db)
    .update(ordersTable)
    .set({ statusId, echangeResolvedAt: now })
    .where(and(eq(ordersTable.id, echangeId), isNull(ordersTable.echangeResolvedAt)))
    .returning({ id: ordersTable.id });
  return claimed.length > 0;
}

/** The swap happened: the Returned Pairs come back, to whoever sold them. */
async function completeSwap(tx: Executor, echangeId: string, now: Date) {
  const e = tx as typeof db;
  if (!(await claim(e, echangeId, DELIVERED_STATUS_ID, now))) return false;

  const returned = await e
    .select({
      inventoryId: orderItems.shoeInventoryId,
      quantity: echangeReturns.quantity,
      borrowerId: ordersTable.borrowerId,
    })
    .from(echangeReturns)
    .innerJoin(orderItems, eq(echangeReturns.orderItemId, orderItems.id))
    .innerJoin(ordersTable, eq(orderItems.orderId, ordersTable.id))
    .where(eq(echangeReturns.echangeId, echangeId));

  // None for a Legacy Échange: status only.
  if (returned.length > 0) {
    await applyMovement(
      {
        reason: "echange-return",
        items: returned.map((r) => ({ inventoryId: r.inventoryId, quantity: r.quantity })),
        // One Original Order per Échange, so one seller: a borrower's pair
        // goes back to their Holdings, exactly as a retour would.
        borrowerId: returned[0].borrowerId ?? undefined,
        orderId: echangeId,
      },
      tx,
    );
  }
  return true;
}

/** Refused: the Outgoing Pairs come back, and the Original Order is untouched. */
async function refuse(
  tx: Executor,
  echangeId: string,
  borrowerId: string | null,
  now: Date,
) {
  const e = tx as typeof db;
  if (!(await claim(e, echangeId, RETURNED_STATUS_ID, now))) return false;

  const [linked] = await e
    .select({ id: echangeReturns.id })
    .from(echangeReturns)
    .where(eq(echangeReturns.echangeId, echangeId))
    .limit(1);
  // A Legacy Échange: status only.
  if (!linked) return true;

  const outgoing = await e
    .select({ inventoryId: orderItems.shoeInventoryId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, echangeId));
  if (outgoing.length > 0) {
    await applyMovement(
      {
        reason: "retour",
        items: outgoing,
        borrowerId: borrowerId ?? undefined,
        orderId: echangeId,
      },
      tx,
    );
  }
  return true;
}
