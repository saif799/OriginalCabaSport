import { asc, eq } from "drizzle-orm";

import { db, txClient, type Executor } from "@/lib/db";
import {
  LendedShoes,
  arrivalItems,
  arrivals,
  echangeReturns,
  orderItems,
  ordersTable,
  shoeInventory,
  stockMovements,
  storeSales,
} from "@/lib/schema";
import {
  CANCELED_STATUS_ID,
  DELIVERED_STATUS_ID,
  RETURNED_STATUS_ID,
} from "@/lib/orders/status";
import { ECHANGE_TYPE } from "@/lib/orders/orderType";

/**
 * Reconstructed Movements (ADR-0010): the Movement Ledger's best reading of
 * everything that happened before it existed, rebuilt from the side tables
 * that still remember part of it.
 *
 * It is deliberately modest. A source row becomes a ledger row only when the
 * past recorded both that it happened and when; nothing is inferred. An order
 * that came back therefore gets its sale and no reversal — the status changed
 * with no date attached — and the history page reads the order's status
 * instead (`getHistorySummary`). Past corrections, reverted store sales and
 * stock older than the first arrivage are simply not there.
 *
 * This is the one writer of the ledger besides `applyMovement`, and it only
 * ever writes `reconstructed = true` rows.
 */

export type BackfillSources = {
  /** What the ledger recorded live, which must not be told to it a second time. */
  live: {
    reason: string;
    shoeInventoryId: string;
    borrowerId: string | null;
    orderId: string | null;
    arrivalId: string | null;
    lendedDelta: number;
    occurredAt: Date;
  }[];
  arrivalItems: {
    arrivalId: string;
    inventoryId: string;
    quantity: number;
    arrivedAt: Date;
  }[];
  orders: {
    id: string;
    /** `YYYY-MM-DD` — orders only ever recorded the day. */
    createdAt: string;
    type: number;
    statusId: string;
    borrowerId: string | null;
    echangeResolvedAt: Date | null;
  }[];
  orderItems: { id: string; orderId: string; inventoryId: string; quantity: number }[];
  echangeReturns: { echangeId: string; orderItemId: string; quantity: number }[];
  storeSales: { inventoryId: string; soldAt: Date }[];
  lended: {
    inventoryId: string;
    borrowerId: string;
    quantity: number;
    /** `YYYY-MM-DD`. */
    createdAt: string;
  }[];
};

export type ReconstructedMovement = {
  groupId: string;
  shoeInventoryId: string;
  reason: string;
  requested: number;
  delta: number;
  lendedDelta: number;
  borrowerId: string | null;
  orderId: string | null;
  arrivalId: string | null;
  reconstructed: true;
  occurredAt: Date;
};

/**
 * Where on the timeline a day-only record goes: the end of that shop day, so
 * a sale never sorts ahead of the arrivage, timed to the minute, that stocked
 * it the same morning. Algeria keeps UTC+1 all year, so the offset is fixed.
 */
export function endOfShopDay(day: string): Date {
  return new Date(`${day}T23:59:59+01:00`);
}

/** How far apart a store sale's own row and its ledger row can be stamped. */
const STORE_SALE_SLACK_MS = 60_000;

const SALE_REASONS = new Set(["sale", "borrower-sale"]);
const REVERSAL_REASONS = new Set(["cancel", "retour", "echange-return"]);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

export function reconstructMovements(sources: BackfillSources): ReconstructedMovement[] {
  const out: ReconstructedMovement[] = [];
  const emit = (
    event: { groupId: string; occurredAt: Date },
    row: {
      reason: string;
      inventoryId: string;
      quantity: number;
      /** Direction of Physical Quantity: +1, -1, or 0 for a change of location only. */
      physical: 1 | -1 | 0;
      lendedDelta?: number;
      borrowerId?: string | null;
      orderId?: string | null;
      arrivalId?: string | null;
    },
  ) =>
    out.push({
      ...event,
      shoeInventoryId: row.inventoryId,
      reason: row.reason,
      requested: row.quantity,
      // Nothing recorded an oversell, so the past is taken at its word.
      delta: row.physical * row.quantity,
      lendedDelta: row.lendedDelta ?? 0,
      borrowerId: row.borrowerId ?? null,
      orderId: row.orderId ?? null,
      arrivalId: row.arrivalId ?? null,
      reconstructed: true,
    });
  const newEvent = (occurredAt: Date) => ({ groupId: crypto.randomUUID(), occurredAt });

  const liveSales = new Set<string>();
  const liveReversals = new Set<string>();
  const liveArrivals = new Set<string>();
  let firstLive: Date | null = null;
  for (const row of sources.live) {
    if (row.orderId && SALE_REASONS.has(row.reason)) liveSales.add(row.orderId);
    if (row.orderId && REVERSAL_REASONS.has(row.reason)) liveReversals.add(row.orderId);
    if (row.arrivalId) liveArrivals.add(row.arrivalId);
    if (!firstLive || row.occurredAt < firstLive) firstLive = row.occurredAt;
  }

  // `lended_shoes` says a Borrower's Holdings changed, never why. Every row a
  // known cause explains is taken out of this pool; what is left over at the
  // end was a plain lend or bring-back.
  const pool = sources.lended.map((row) => ({ ...row, used: false }));
  const explain = (
    inventoryId: string,
    borrowerId: string,
    quantity: number,
    // `on`: the day the row was most likely written. `notBefore`: the cause
    // cannot have a row older than this — a pair comes back after its order,
    // and the same-sized `+1` from before the order is the lend that let the
    // Borrower sell it, which must stay a lend.
    when: { on?: string; notBefore?: string } = {},
  ) => {
    const matches = pool.filter(
      (row) =>
        !row.used &&
        row.inventoryId === inventoryId &&
        row.borrowerId === borrowerId &&
        row.quantity === quantity &&
        (!when.notBefore || row.createdAt >= when.notBefore),
    );
    const match =
      matches.find((row) => row.createdAt === when.on) ??
      // Later than the order's own day first: that day's row is as likely the
      // lend the sale was made from.
      matches.find((row) => !when.notBefore || row.createdAt > when.notBefore) ??
      matches[0];
    if (match) match.used = true;
  };
  const utcDay = (at: Date) => at.toISOString().slice(0, 10);

  for (const row of sources.live) {
    if (row.borrowerId && row.lendedDelta !== 0) {
      explain(row.shoeInventoryId, row.borrowerId, row.lendedDelta, {
        on: utcDay(row.occurredAt),
      });
    }
  }

  // Arrivages.
  for (const [arrivalId, items] of groupBy(sources.arrivalItems, (i) => i.arrivalId)) {
    if (liveArrivals.has(arrivalId)) continue;
    const event = newEvent(items[0].arrivedAt);
    for (const item of items) {
      emit(event, { reason: "arrival", ...item, physical: 1, arrivalId });
    }
  }

  // Orders: the sale, on the day the order was placed.
  const itemsByOrder = groupBy(sources.orderItems, (i) => i.orderId);
  const orderById = new Map(sources.orders.map((o) => [o.id, o]));
  const itemById = new Map(sources.orderItems.map((i) => [i.id, i]));

  for (const order of sources.orders) {
    const items = itemsByOrder.get(order.id) ?? [];
    if (items.length === 0 || liveSales.has(order.id)) continue;

    const { borrowerId } = order;
    const event = newEvent(endOfShopDay(order.createdAt));
    for (const item of items) {
      emit(event, {
        reason: borrowerId ? "borrower-sale" : "sale",
        ...item,
        physical: -1,
        lendedDelta: borrowerId ? -item.quantity : 0,
        borrowerId,
        orderId: order.id,
      });
      if (borrowerId) {
        explain(item.inventoryId, borrowerId, -item.quantity, { on: order.createdAt });
      }
    }

    // The pairs of a Borrower's order that came back went back to their
    // Holdings. That gets no row of its own — it has no date — but its
    // `lended_shoes` row is explained, so it does not read as a fresh lend.
    // An Échange the resolver decided is settled below, by its own rows.
    const cameBack =
      (order.statusId === RETURNED_STATUS_ID || order.statusId === CANCELED_STATUS_ID) &&
      order.echangeResolvedAt === null &&
      !liveReversals.has(order.id);
    if (borrowerId && cameBack) {
      for (const item of items) {
        explain(item.inventoryId, borrowerId, item.quantity, { notBefore: order.createdAt });
      }
    }
  }

  // Échanges the resolver decided before the ledger existed (ADR-0009). These
  // are the one reversal the past did date: `echange_resolved_at`.
  const returnsByEchange = groupBy(sources.echangeReturns, (r) => r.echangeId);
  for (const echange of sources.orders) {
    const links = returnsByEchange.get(echange.id);
    if (
      echange.type !== ECHANGE_TYPE ||
      echange.echangeResolvedAt === null ||
      !links || // a Legacy Échange: status only, its stock was never moved
      liveReversals.has(echange.id)
    ) {
      continue;
    }
    const event = newEvent(echange.echangeResolvedAt);
    const resolved = { on: utcDay(echange.echangeResolvedAt), notBefore: echange.createdAt };

    if (echange.statusId === DELIVERED_STATUS_ID) {
      // Swapped: the Returned Pairs come back, to whoever sold them.
      for (const link of links) {
        const line = itemById.get(link.orderItemId);
        if (!line) continue;
        const seller = orderById.get(line.orderId)?.borrowerId ?? null;
        emit(event, {
          reason: "echange-return",
          inventoryId: line.inventoryId,
          quantity: link.quantity,
          physical: 1,
          lendedDelta: seller ? link.quantity : 0,
          borrowerId: seller,
          orderId: echange.id,
        });
        if (seller) explain(line.inventoryId, seller, link.quantity, resolved);
      }
    } else if (echange.statusId === RETURNED_STATUS_ID) {
      // Refused: the Outgoing Pairs come back.
      for (const item of itemsByOrder.get(echange.id) ?? []) {
        emit(event, {
          reason: "retour",
          ...item,
          physical: 1,
          lendedDelta: echange.borrowerId ? item.quantity : 0,
          borrowerId: echange.borrowerId,
          orderId: echange.id,
        });
        if (echange.borrowerId) {
          explain(item.inventoryId, echange.borrowerId, item.quantity, resolved);
        }
      }
    }
  }

  // Store sales carry no link the ledger could be matched on, only a time —
  // and not quite the same time: `store_sales` stamps the start of the
  // transaction, the ledger the movement inside it, each by its own clock. So
  // a sale is the ledger's if it is later than the first live row, or sits
  // within a moment of a live shop sale of the same size.
  const liveShopSales = sources.live
    .filter((row) => row.reason === "sale" && !row.orderId)
    .map((row) => ({ ...row, matched: false }));
  for (const sale of sources.storeSales) {
    if (firstLive && sale.soldAt >= firstLive) continue;
    const own = liveShopSales.find(
      (row) =>
        !row.matched &&
        row.shoeInventoryId === sale.inventoryId &&
        Math.abs(row.occurredAt.getTime() - sale.soldAt.getTime()) <= STORE_SALE_SLACK_MS,
    );
    if (own) {
      own.matched = true;
      continue;
    }
    emit(newEvent(sale.soldAt), {
      reason: "sale",
      inventoryId: sale.inventoryId,
      quantity: 1,
      physical: -1,
    });
  }

  // Whatever nothing above explained: one event per Borrower, day and direction.
  const leftover = pool.filter((row) => !row.used && row.quantity !== 0);
  const lendEvents = groupBy(
    leftover,
    (row) => `${row.borrowerId}|${row.createdAt}|${row.quantity > 0 ? "lend" : "return"}`,
  );
  for (const rows of lendEvents.values()) {
    const event = newEvent(endOfShopDay(rows[0].createdAt));
    for (const row of rows) {
      emit(event, {
        reason: row.quantity > 0 ? "lend" : "return",
        inventoryId: row.inventoryId,
        quantity: Math.abs(row.quantity),
        physical: 0,
        lendedDelta: row.quantity,
        borrowerId: row.borrowerId,
      });
    }
  }

  return out;
}

async function loadSources(e: typeof db): Promise<BackfillSources> {
  const [live, arrivalRows, orders, items, links, sales, lended] = await Promise.all([
    e
      .select({
        reason: stockMovements.reason,
        shoeInventoryId: stockMovements.shoeInventoryId,
        borrowerId: stockMovements.borrowerId,
        orderId: stockMovements.orderId,
        arrivalId: stockMovements.arrivalId,
        lendedDelta: stockMovements.lendedDelta,
        occurredAt: stockMovements.occurredAt,
      })
      .from(stockMovements)
      .where(eq(stockMovements.reconstructed, false)),
    e
      .select({
        arrivalId: arrivalItems.arrivalId,
        inventoryId: arrivalItems.shoeInventoryId,
        quantity: arrivalItems.quantity,
        arrivedAt: arrivals.createdAt,
      })
      .from(arrivalItems)
      .innerJoin(arrivals, eq(arrivalItems.arrivalId, arrivals.id))
      .orderBy(asc(arrivals.createdAt)),
    e
      .select({
        id: ordersTable.id,
        createdAt: ordersTable.createdAt,
        type: ordersTable.type,
        statusId: ordersTable.statusId,
        borrowerId: ordersTable.borrowerId,
        echangeResolvedAt: ordersTable.echangeResolvedAt,
      })
      .from(ordersTable)
      .orderBy(asc(ordersTable.createdAt), asc(ordersTable.id)),
    e
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        inventoryId: orderItems.shoeInventoryId,
        quantity: orderItems.quantity,
      })
      .from(orderItems),
    e
      .select({
        echangeId: echangeReturns.echangeId,
        orderItemId: echangeReturns.orderItemId,
        quantity: echangeReturns.quantity,
      })
      .from(echangeReturns),
    e
      .select({ inventoryId: storeSales.shoeInventoryId, soldAt: storeSales.createdAt })
      .from(storeSales)
      .orderBy(asc(storeSales.createdAt)),
    e
      .select({
        inventoryId: LendedShoes.shoeInventoryId,
        borrowerId: LendedShoes.borrowerId,
        quantity: LendedShoes.quantity,
        createdAt: LendedShoes.createdAt,
      })
      .from(LendedShoes)
      .orderBy(asc(LendedShoes.createdAt), asc(LendedShoes.id)),
  ]);

  return {
    live,
    arrivalItems: arrivalRows,
    orders,
    orderItems: items,
    echangeReturns: links,
    storeSales: sales,
    lended,
  };
}

export type BackfillResult = {
  /** Reconstructed rows this run computed, per reason. */
  counts: Record<string, number>;
  total: number;
  /** Reconstructed rows that were in the ledger before this run. */
  replaced: number;
  applied: boolean;
};

/** Rows per INSERT — well inside Postgres's 65 535 bind-parameter ceiling. */
const INSERT_CHUNK = 500;

/**
 * Computes the Reconstructed Movements and, with `apply`, swaps them in for
 * whatever an earlier run left: every `reconstructed` row is deleted and the
 * fresh set inserted in one transaction, so a re-run converges instead of
 * piling up. Live rows are read, never touched.
 *
 * A re-run reads the side tables as they are *now*. It is for correcting the
 * backfill around go-live, not for later: a Borrower deleted since has taken
 * their `lended_shoes` rows along, and a re-run would drop the lends it once
 * reconstructed from them.
 *
 * A row whose size no longer exists is dropped rather than failing the run —
 * the side tables are older than some of the catalogue.
 */
export async function backfillStockMovements(
  { apply }: { apply: boolean },
  exec?: Executor,
): Promise<BackfillResult> {
  const reader = (exec ?? db) as typeof db;
  const [sources, sizes, existing] = await Promise.all([
    loadSources(reader),
    reader.select({ id: shoeInventory.id }).from(shoeInventory),
    reader
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.reconstructed, true)),
  ]);

  const known = new Set(sizes.map((s) => s.id));
  const rows = reconstructMovements(sources).filter((row) => known.has(row.shoeInventoryId));

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  const result = { counts, total: rows.length, replaced: existing.length };
  if (!apply) return { ...result, applied: false };

  const write = async (tx: Executor) => {
    const t = tx as typeof db;
    await t.delete(stockMovements).where(eq(stockMovements.reconstructed, true));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await t.insert(stockMovements).values(rows.slice(i, i + INSERT_CHUNK));
    }
  };
  if (exec) await write(exec);
  else await txClient().transaction((tx) => write(tx));

  return { ...result, applied: true };
}
