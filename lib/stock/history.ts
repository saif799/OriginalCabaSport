import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db, type Executor } from "@/lib/db";
import {
  LendedShoes,
  arrivals,
  borrower,
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
  stockMovements,
} from "@/lib/schema";
import { CANCELED_STATUS_ID, RETURNED_STATUS_ID } from "@/lib/orders/status";
import {
  eventFamily,
  movesLocationOnly,
  reasonsOf,
  type EventFamily,
} from "./eventFamily";

/**
 * The read side of the Movement Ledger (ADR-0010): what happened to the
 * colours the owner picked. Nothing here writes, and nothing here is a source
 * of a quantity — "in stock now" and "at borrowers now" are read live from the
 * tables that own them.
 */

/** Events per page. A page is a stretch of a timeline, not a search result. */
export const HISTORY_PAGE_SIZE = 50;

/** The store runs on Algiers time; the server does not. A day filter means the shop's day. */
export const SHOP_TZ = "Africa/Algiers";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` the date filters can hand to Postgres without it throwing.
 * Round-tripped, because JS reads "2026-02-31" as the 3rd of March and
 * Postgres reads it as an error.
 */
export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export type HistoryFilters = {
  /** Colour variants to read. None selected reads nothing — there is no global feed. */
  shoeIds: string[];
  sizes?: string[];
  families?: EventFamily[];
  borrowerId?: string | null;
  /** Shop-local days, inclusive at both ends. */
  from?: string | null;
  to?: string | null;
  /** 1-based. */
  page?: number;
};

export type HistorySize = {
  size: string;
  /** Units asked for; more than the movement took means it hit the floor at zero. */
  requested: number;
  delta: number;
  lendedDelta: number;
  /** Null on a Reconstructed Movement: nothing recorded the level at the time. */
  quantityBefore: number | null;
  quantityAfter: number | null;
};

/** One movement, as it touched one colour. */
export type HistoryEvent = {
  groupId: string;
  shoeId: string;
  modelName: string;
  color: string;
  reason: string;
  family: EventFamily;
  occurredAt: Date;
  reconstructed: boolean;
  /**
   * Pairs this event moved, signed the way the family reads: negative for a
   * sale, positive for an arrival or a return to stock, and the plain count of
   * pairs that changed hands for a lend or a bring-back.
   */
  units: number;
  /** A sale that asked for more pairs than the stock held. */
  oversold: boolean;
  sizes: HistorySize[];
  borrower: { id: string; name: string } | null;
  /** `statusId`/`statusName` are the order's status *now*, not at the time. */
  order: { id: string; statusId: string; statusName: string | null; type: number } | null;
  arrival: { id: string; reference: string | null } | null;
  note: string | null;
};

const SALE_REASONS = reasonsOf(["sold"]);
const CAME_BACK_REASONS = reasonsOf(["came-back"]);

const localDay = sql`(${stockMovements.occurredAt} AT TIME ZONE ${SHOP_TZ})::date`;

/** The filters every ledger read shares; the Event Family filter is the timeline's alone. */
function ledgerFilters(filters: HistoryFilters): (SQL | undefined)[] {
  return [
    inArray(shoes.id, filters.shoeIds),
    filters.sizes?.length ? inArray(shoeInventory.size, filters.sizes) : undefined,
    filters.borrowerId ? eq(stockMovements.borrowerId, filters.borrowerId) : undefined,
    isIsoDay(filters.from) ? sql`${localDay} >= ${filters.from}::date` : undefined,
    isIsoDay(filters.to) ? sql`${localDay} <= ${filters.to}::date` : undefined,
  ];
}

/** "38" before "38.5" before "40"; anything that isn't a number sorts by name. */
export function compareSizes(a: string, b: string): number {
  const [x, y] = [Number(a), Number(b)];
  if (Number.isNaN(x) || Number.isNaN(y)) return a.localeCompare(b);
  return x - y;
}

export async function getMovementHistory(
  filters: HistoryFilters,
  exec: Executor = db,
): Promise<{ events: HistoryEvent[]; total: number }> {
  if (filters.shoeIds.length === 0) return { events: [], total: 0 };
  const e = exec as typeof db;

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const occurredAt = sql<Date>`max(${stockMovements.occurredAt})`.mapWith(
    stockMovements.occurredAt,
  );

  const rows = await e
    .select({
      groupId: stockMovements.groupId,
      shoeId: shoes.id,
      modelName: shoeModels.modelName,
      color: shoes.color,
      reason: stockMovements.reason,
      occurredAt,
      reconstructed: sql<boolean>`bool_or(${stockMovements.reconstructed})`,
      note: sql<string | null>`max(${stockMovements.note})`,
      sizes: sql<HistorySize[]>`json_agg(json_build_object(
        'size', ${shoeInventory.size},
        'requested', ${stockMovements.requested},
        'delta', ${stockMovements.delta},
        'lendedDelta', ${stockMovements.lendedDelta},
        'quantityBefore', ${stockMovements.quantityBefore},
        'quantityAfter', ${stockMovements.quantityAfter}
      ))`,
      borrowerId: stockMovements.borrowerId,
      borrowerName: borrower.name,
      orderId: stockMovements.orderId,
      orderStatusId: ordersTable.statusId,
      orderStatusName: stautsGroupsTable.name,
      orderType: ordersTable.type,
      arrivalId: stockMovements.arrivalId,
      arrivalReference: arrivals.reference,
      // Counts events, not ledger rows: the window runs over the groups.
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(stockMovements)
    .innerJoin(shoeInventory, eq(stockMovements.shoeInventoryId, shoeInventory.id))
    .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .leftJoin(borrower, eq(stockMovements.borrowerId, borrower.id))
    .leftJoin(ordersTable, eq(stockMovements.orderId, ordersTable.id))
    .leftJoin(stautsGroupsTable, eq(ordersTable.statusId, stautsGroupsTable.id))
    .leftJoin(arrivals, eq(stockMovements.arrivalId, arrivals.id))
    .where(
      and(
        ...ledgerFilters(filters),
        filters.families?.length
          ? inArray(stockMovements.reason, reasonsOf(filters.families))
          : undefined,
      ),
    )
    // One movement carries one reason, Borrower, order and arrivage, so these
    // only split a group by colour — they are here to be selectable.
    .groupBy(
      stockMovements.groupId,
      shoes.id,
      shoeModels.modelName,
      shoes.color,
      stockMovements.reason,
      stockMovements.borrowerId,
      borrower.name,
      stockMovements.orderId,
      ordersTable.statusId,
      stautsGroupsTable.name,
      ordersTable.type,
      stockMovements.arrivalId,
      arrivals.reference,
    )
    // Day-precision rows tie constantly; the group and colour break the tie so
    // LIMIT/OFFSET paging cannot repeat or skip an event between pages.
    .orderBy(desc(occurredAt), desc(stockMovements.groupId), asc(shoes.id))
    .limit(HISTORY_PAGE_SIZE)
    .offset((page - 1) * HISTORY_PAGE_SIZE);

  const events = rows.map((row): HistoryEvent => {
    const family = eventFamily(row.reason);
    const sizes = [...row.sizes].sort((a, b) => compareSizes(a.size, b.size));
    const moved = sizes.reduce((sum, s) => sum + s.delta, 0);
    const changedHands = sizes.reduce((sum, s) => sum + s.lendedDelta, 0);

    return {
      groupId: row.groupId,
      shoeId: row.shoeId,
      modelName: row.modelName,
      color: row.color,
      reason: row.reason,
      family,
      occurredAt: row.occurredAt,
      reconstructed: row.reconstructed,
      units: movesLocationOnly(family) ? Math.abs(changedHands) : moved,
      oversold: family === "sold" && sizes.some((s) => s.requested > -s.delta),
      sizes,
      borrower:
        row.borrowerId && row.borrowerName
          ? { id: row.borrowerId, name: row.borrowerName }
          : null,
      order:
        row.orderId && row.orderStatusId
          ? {
              id: row.orderId,
              statusId: row.orderStatusId,
              statusName: row.orderStatusName,
              type: row.orderType ?? 1,
            }
          : null,
      arrival: row.arrivalId
        ? { id: row.arrivalId, reference: row.arrivalReference }
        : null,
      note: row.note,
    };
  });

  return { events, total: rows[0]?.total ?? 0 };
}

export type HistorySummary = {
  shoeId: string;
  modelName: string;
  color: string;
  /** Ledger sums, following the size / Borrower / date filters. */
  arrived: number;
  /** Gross: a pair sold and returned counts here and in `cameBack`. */
  sold: number;
  cameBack: number;
  /** Live, whatever the date filter says. */
  atBorrowers: number;
  inStock: number;
};

/**
 * A Reconstructed sale has no reversal row — the past kept the fact that an
 * order came back, never the date. Its order's status stands in for one, with
 * two exceptions: a reversal the ledger did record live (or it counts twice),
 * and an Échange the resolver decided, whose status says nothing about its
 * stock — if pairs moved, the backfill gave them a row of their own (ADR-0009).
 */
const cameBackByStatus = sql`(
  ${stockMovements.reconstructed}
  AND ${inArray(stockMovements.reason, SALE_REASONS)}
  AND ${inArray(ordersTable.statusId, [RETURNED_STATUS_ID, CANCELED_STATUS_ID])}
  AND ${ordersTable.echangeResolvedAt} IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements reversal
    WHERE reversal.order_id = ${stockMovements.orderId}
      AND reversal.reason IN ('cancel', 'retour')
  )
)`;

/** One row per selected colour, in the order they were selected. */
export async function getHistorySummary(
  filters: HistoryFilters,
  exec: Executor = db,
): Promise<HistorySummary[]> {
  if (filters.shoeIds.length === 0) return [];
  const e = exec as typeof db;

  const sizeFilter = filters.sizes?.length
    ? inArray(shoeInventory.size, filters.sizes)
    : undefined;
  const sum = (expression: SQL, condition: SQL | undefined) =>
    sql<number>`coalesce(sum(${expression}) filter (where ${condition}), 0)`.mapWith(Number);

  const held = sql`(
    SELECT SUM(${LendedShoes.quantity}) FROM ${LendedShoes}
    WHERE ${LendedShoes.shoeInventoryId} = ${shoeInventory.id}
    ${filters.borrowerId ? sql`AND ${LendedShoes.borrowerId} = ${filters.borrowerId}` : sql``}
  )`;

  const [ledger, live] = await Promise.all([
    e
      .select({
        shoeId: shoes.id,
        arrived: sum(sql`${stockMovements.delta}`, eq(stockMovements.reason, "arrival")),
        sold: sum(
          sql`-${stockMovements.delta}`,
          inArray(stockMovements.reason, SALE_REASONS),
        ),
        cameBack: sum(
          sql`${stockMovements.delta}`,
          inArray(stockMovements.reason, CAME_BACK_REASONS),
        ),
        cameBackByStatus: sum(sql`-${stockMovements.delta}`, cameBackByStatus),
      })
      .from(stockMovements)
      .innerJoin(shoeInventory, eq(stockMovements.shoeInventoryId, shoeInventory.id))
      .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
      .leftJoin(ordersTable, eq(stockMovements.orderId, ordersTable.id))
      .where(and(...ledgerFilters(filters)))
      .groupBy(shoes.id),
    e
      .select({
        shoeId: shoes.id,
        modelName: shoeModels.modelName,
        color: shoes.color,
        inStock: sql<number>`coalesce(sum(${shoeInventory.quantity}), 0)`.mapWith(Number),
        atBorrowers: sql<number>`coalesce(sum(${held}), 0)`.mapWith(Number),
      })
      .from(shoes)
      .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
      .leftJoin(shoeInventory, and(eq(shoeInventory.shoeId, shoes.id), sizeFilter))
      .where(inArray(shoes.id, filters.shoeIds))
      .groupBy(shoes.id, shoeModels.modelName, shoes.color),
  ]);

  const sums = new Map(ledger.map((row) => [row.shoeId, row]));
  const liveByShoe = new Map(live.map((row) => [row.shoeId, row]));

  return filters.shoeIds.flatMap((shoeId) => {
    const row = liveByShoe.get(shoeId);
    if (!row) return [];
    const totals = sums.get(shoeId);
    return [
      {
        shoeId,
        modelName: row.modelName,
        color: row.color,
        arrived: totals?.arrived ?? 0,
        sold: totals?.sold ?? 0,
        cameBack: (totals?.cameBack ?? 0) + (totals?.cameBackByStatus ?? 0),
        atBorrowers: row.atBorrowers,
        inStock: row.inStock,
      },
    ];
  });
}
