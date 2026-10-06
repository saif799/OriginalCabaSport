/**
 * One-off repair: put the Legacy Échanges that the old status sync marked
 * `retour` back on `Livre` — status only, no stock movement.
 *
 * Why: the sync used to read only an Échange's own tracking. That tracking goes
 * to a return status the moment the swap happens (it carries the Returned Pair
 * back — see ADR-0009), so every completed Échange was flipped to `retour` and
 * counted as a parcel the customer sent back. Their stock was wrong the other
 * way too, but the owner reconciles that by hand: this script never calls
 * `applyMovement`.
 *
 * Only an Échange whose Delivery Leg (`<tracking>-EXCH`) DHD reports delivered
 * is flipped — that is what says the swap happened. One with no Delivery Leg
 * was genuinely refused, is correctly `retour`, and is listed and left alone.
 * A flipped order is also marked decided, so the sync never reads its own
 * tracking's return status again.
 *
 * Run it only once the sync change (resolveEchanges) is deployed: the old sync
 * would flip these straight back to `retour` on its next run.
 *
 * Run from repo root:
 *   npx tsx lib/scripts/fixLegacyEchanges.ts          # dry run, prints the plan
 *   npx tsx lib/scripts/fixLegacyEchanges.ts --apply  # writes the changes
 *
 * Safe to re-run: a flipped order is no longer `retour`, so it is not picked up.
 */

// First, so DATABASE_URL and the DHD key are set before anything reads them.
import "dotenv/config";
import { and, eq, notExists } from "drizzle-orm";

import { db } from "@/lib/db";
import { echangeReturns, ordersTable, stautsGroupsTable } from "@/lib/schema";
import { DELIVERED_STATUS_ID, RETURNED_STATUS_ID } from "@/lib/orders/status";
import { ECHANGE_TYPE } from "@/lib/orders/orderType";
import { DELIVERY_LEG_SUFFIX } from "@/lib/orders/echange";
import { fetchDhdTrackingStatuses } from "@/lib/delivery/dhdTrackings";

async function main() {
  const apply = process.argv.includes("--apply");

  const legacy = await db
    .select({
      id: ordersTable.id,
      createdAt: ordersTable.createdAt,
      reference: ordersTable.reference,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.type, ECHANGE_TYPE),
        eq(ordersTable.statusId, RETURNED_STATUS_ID),
        notExists(
          db
            .select({ id: echangeReturns.id })
            .from(echangeReturns)
            .where(eq(echangeReturns.echangeId, ordersTable.id)),
        ),
      ),
    );

  console.log(`${legacy.length} Legacy Échange(s) on retour.\n`);
  if (legacy.length === 0) return;

  // Throws on an HTTP failure — never read "DHD did not answer" as "refused".
  const legs = await fetchDhdTrackingStatuses(
    legacy.map((o) => o.id + DELIVERY_LEG_SUFFIX),
  );
  const legStatus = new Map(legs.map((l) => [l.tracking, l.status]));
  const groups = await db.select().from(stautsGroupsTable);
  const isDelivered = (status: string | undefined) =>
    status !== undefined &&
    groups.find((g) => g.external_statuses.includes(status))?.id === DELIVERED_STATUS_ID;

  const toFlip: string[] = [];
  for (const order of legacy) {
    const status = legStatus.get(order.id + DELIVERY_LEG_SUFFIX);
    const verdict = isDelivered(status)
      ? "swapped   -> Livre"
      : status === undefined
        ? "refused   -> stays retour (no Delivery Leg)"
        : `unclear   -> stays retour (Delivery Leg "${status}" is not mapped to Livre)`;
    if (isDelivered(status)) toFlip.push(order.id);
    console.log(
      `  ${order.id}  ${String(order.createdAt).padEnd(10)}  ${verdict}  ${order.reference ?? ""}`,
    );
  }

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to flip ${toFlip.length} order(s).`);
    return;
  }
  if (toFlip.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  const now = new Date();
  for (const id of toFlip) {
    await db
      .update(ordersTable)
      .set({ statusId: DELIVERED_STATUS_ID, echangeResolvedAt: now })
      .where(and(eq(ordersTable.id, id), eq(ordersTable.statusId, RETURNED_STATUS_ID)));
  }
  console.log(`\nFlipped ${toFlip.length} order(s) to Livre. No stock was moved.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
