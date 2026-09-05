import { inArray } from "drizzle-orm";

import { db, type Executor } from "@/lib/db";
import { ordersTable } from "@/lib/schema";
import { DELIVERED_STATUS_ID, RETURNED_STATUS_ID } from "@/lib/orders/status";
import { phoneKey } from "@/lib/orders/phone";

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
 * Delivery Records for the given phone numbers, keyed by `phoneKey`. A key
 * absent from the map is `unknown` — the caller renders nothing for it.
 *
 * Counting happens here in TypeScript rather than in SQL so that `phoneKey` is
 * the single implementation of the matching rule on the path that decides
 * whether a parcel ships. The cost is fetching every resolved order rather than
 * a grouped count: ~490 rows of (phone, status id) today, which is one small
 * round trip. Revisit the shape past roughly 20k orders — at that point push
 * the grouping into SQL with `phoneKeySql` and accept the duplicated rule.
 */
export async function getDeliveryRecords(
  phones: ReadonlyArray<string | null | undefined>,
  exec: Executor = db,
): Promise<Map<string, DeliveryRecord>> {
  const wanted = new Set<string>();
  for (const phone of phones) {
    const key = phoneKey(phone);
    if (key) wanted.add(key);
  }
  // No ready-to-ship rows on this page means no query at all.
  if (wanted.size === 0) return new Map();

  const rows = await (exec as typeof db)
    .select({
      telephone: ordersTable.telephone,
      statusId: ordersTable.statusId,
    })
    .from(ordersTable)
    .where(
      inArray(ordersTable.statusId, [DELIVERED_STATUS_ID, RETURNED_STATUS_ID]),
    );

  const counts = new Map<string, { delivered: number; returned: number }>();
  for (const row of rows) {
    const key = phoneKey(row.telephone);
    if (!key || !wanted.has(key)) continue;
    const tally = counts.get(key) ?? { delivered: 0, returned: 0 };
    if (row.statusId === DELIVERED_STATUS_ID) tally.delivered += 1;
    else tally.returned += 1;
    counts.set(key, tally);
  }

  const records = new Map<string, DeliveryRecord>();
  for (const [key, { delivered, returned }] of counts) {
    const state = classifyRecord(delivered, returned);
    // Unreachable today — a key only lands in `counts` by way of a delivered or
    // returned row — but the map's contract is "present means it says
    // something", and that has to survive the ladder changing.
    if (state === "unknown") continue;
    records.set(key, { state, delivered, returned });
  }
  return records;
}
