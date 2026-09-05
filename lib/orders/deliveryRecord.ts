import { and, count, eq, inArray, sql } from "drizzle-orm";

import { db, type Executor } from "@/lib/db";
import { ordersTable } from "@/lib/schema";
import { DELIVERED_STATUS_ID, RETURNED_STATUS_ID } from "@/lib/orders/status";
import { canonicalPhone } from "@/lib/orders/phone";

/**
 * The Delivery Record: how every past order sharing one customer's phone number
 * actually ended. It exists to answer one question on the ready-to-ship queue —
 * is this parcel worth sending? — so it counts only outcomes that cost money.
 *
 * Two exclusions are deliberate:
 *
 * - **`Cancel` does not count.** A cancelled order was stopped before it was
 *   ever handed to the courier, so it cost nothing. Counting it would paint
 *   over half the repeat customers red for something that never shipped.
 * - **`telephone_2` is not consulted.** It is the courier's fallback number,
 *   not the customer's identity; two people sharing a household line would
 *   inherit each other's record.
 *
 * Orders still in flight (`prete a expedier`, `vers wilaya`, `en livraison`)
 * have not resolved into anything and count as neither. That is also what makes
 * the current row exclude itself for free: it is ready-to-ship by definition, so
 * it can never be one of its own counters.
 */

export type DeliveryRecordState = "clean" | "mixed" | "poor" | "unknown";

export type DeliveryRecord = {
  state: Exclude<DeliveryRecordState, "unknown">;
  delivered: number;
  returned: number;
};

/**
 * The ladder, resolved top-down. The three rules overlap on purpose — a
 * customer with one delivery and no returns satisfies both "clean" and, read
 * loosely, "has ordered before" — and the order is what turns them into a
 * decision.
 *
 * `unknown` is the floor rather than a tie at zero: a customer with three
 * cancelled orders and nothing else has a history, but none of it says whether
 * their parcels arrive.
 */
export function classifyRecord(
  delivered: number,
  returned: number,
): DeliveryRecordState {
  if (delivered === 0 && returned === 0) return "unknown";
  if (returned > delivered) return "poor";
  if (returned === delivered) return "mixed";
  return "clean";
}

/**
 * Delivery Records for the given orders, keyed by **order id** — the shape the
 * table renders from. An id absent from the result is `unknown`, and renders
 * nothing.
 *
 * Callers pass only the orders the record is wanted for (the ready-to-ship
 * ones); phone normalisation and the keying both stay in here, so no caller
 * needs to know that a Delivery Record is a per-phone idea underneath.
 */
export async function getDeliveryRecordsByOrder(
  orders: ReadonlyArray<{ id: string; telephone: string }>,
  exec: Executor = db,
): Promise<Record<string, DeliveryRecord>> {
  const byPhone = await getDeliveryRecords(
    orders.map((order) => order.telephone),
    exec,
  );
  if (byPhone.size === 0) return {};

  const byOrder: Record<string, DeliveryRecord> = {};
  for (const order of orders) {
    const phone = canonicalPhone(order.telephone);
    const record = phone ? byPhone.get(phone) : undefined;
    if (record) byOrder[order.id] = record;
  }
  return byOrder;
}

/**
 * Delivery Records for the given phone numbers, keyed by canonical phone. A
 * number absent from the map is `unknown` — the caller renders nothing for it.
 *
 * One grouped query, reading only the rows that belong to the phones asked
 * about: at most one row back per phone, so a 15-row page costs at most 15.
 * This is only correct because `orders.telephone` is stored canonically — see
 * the header of `lib/orders/phone.ts` for what guarantees that, and re-run the
 * backfill there if a write path ever bypasses it.
 */
export async function getDeliveryRecords(
  phones: ReadonlyArray<string | null | undefined>,
  exec: Executor = db,
): Promise<Map<string, DeliveryRecord>> {
  const wanted = new Set<string>();
  for (const phone of phones) {
    const canonical = canonicalPhone(phone);
    if (canonical) wanted.add(canonical);
  }
  // No ready-to-ship rows on this page means no query at all.
  if (wanted.size === 0) return new Map();

  // Counted in SQL rather than by tallying rows here: the two counters are the
  // whole payload, so there is no reason to ship the underlying rows over the
  // wire to add them up.
  const rows = await (exec as typeof db)
    .select({
      telephone: ordersTable.telephone,
      delivered: count(
        sql`CASE WHEN ${eq(ordersTable.statusId, DELIVERED_STATUS_ID)} THEN 1 END`,
      ),
      returned: count(
        sql`CASE WHEN ${eq(ordersTable.statusId, RETURNED_STATUS_ID)} THEN 1 END`,
      ),
    })
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.telephone, [...wanted]),
        inArray(ordersTable.statusId, [
          DELIVERED_STATUS_ID,
          RETURNED_STATUS_ID,
        ]),
      ),
    )
    .groupBy(ordersTable.telephone);

  const records = new Map<string, DeliveryRecord>();
  for (const { telephone, delivered, returned } of rows) {
    const state = classifyRecord(delivered, returned);
    // Unreachable while the query filters to delivered/returned rows, but the
    // map's contract is "present means it says something", and that has to
    // survive the ladder or the filter changing.
    if (state === "unknown") continue;
    records.set(telephone, { state, delivered, returned });
  }
  return records;
}
