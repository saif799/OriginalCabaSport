import { db, txClient } from "@/lib/db";
import { ordersTable, orderItems } from "@/lib/schema";
import { applyMovement } from "@/lib/stock/movement";
import { revalidateStockPaths } from "@/lib/stock/revalidate";
import {
  getAllStatusGroups,
  buildNameToIdMap,
  RESOLVED_STATUS_IDS,
} from "@/lib/orders/status";
import { DELIVERY_PROVIDERS, type SyncTargets } from "@/lib/delivery";
import { and, eq, inArray, ne } from "drizzle-orm";
import { ECHANGE_TYPE } from "@/lib/orders/orderType";
import {
  resolveEchanges,
  takesStatusFromOwnTracking,
} from "@/lib/orders/echange";
import { hasAdminSession } from "@/lib/auth/guard";
import { isCronRequest } from "@/lib/auth/session";

/**
 * The only route with two legitimate callers, so the only one that accepts two
 * credentials: the Vercel nightly cron (bearer CRON_SECRET) and the admin
 * "sync now" button (session cookie). Guarding it with the session alone would
 * have failed silently — the cron would 401 every night with nobody watching,
 * and delivery statuses would just stop updating.
 *
 * It is a GET that mutates stock (`retour` movements, bulk status updates), so
 * leaving it open was never really "just a read".
 */
export async function GET(request: Request) {
  if (!isCronRequest(request) && !(await hasAdminSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Group our order ids by provider so each provider syncs only its own
    // parcels. Undecided Échanges count as in flight: resolveEchanges can only
    // decide one once its Return Leg has been seen returning, even if that
    // happens after get/orders has dropped it.
    const orders = await db
      .select({
        id: ordersTable.id,
        provider: ordersTable.provider,
        statusId: ordersTable.statusId,
      })
      .from(ordersTable);

    const targetsByProvider: Record<string, SyncTargets> = {};
    for (const o of orders) {
      const targets = (targetsByProvider[o.provider ?? "dhd"] ??= {
        all: [],
        inFlight: [],
      });
      targets.all.push(o.id);
      if (!RESOLVED_STATUS_IDS.includes(o.statusId)) {
        targets.inFlight.push(o.id);
      }
    }

    // Pull parcels + statuses from every provider. A provider failing (or having
    // no orders) must not break the whole sync.
    const providerStatuses = (
      await Promise.all(
        DELIVERY_PROVIDERS.map((p) =>
          p
            .fetchStatuses(targetsByProvider[p.name] ?? { all: [], inFlight: [] })
            .catch((e) => {
              console.log(`${p.name} status sync failed`, e);
              return [];
            }),
        ),
      )
    ).flat();

    const dbStatuses = await getAllStatusGroups();
    const statusNameToId = buildNameToIdMap(dbStatuses);

    // group the (provider) parcels by our internal status name
    const groupedStatuses: Record<string, Array<string>> = {};
    // A courier label missing from external_statuses leaves its order where it
    // is, every sync, without a trace — so name them.
    const unmapped = new Set<string>();

    providerStatuses.forEach((order) => {
      const originalstatus = dbStatuses.find((s) =>
        s.external_statuses.includes(order.status),
      );
      if (!originalstatus) {
        unmapped.add(order.status);
        return;
      }
      if (!groupedStatuses[originalstatus.name]) {
        groupedStatuses[originalstatus.name] = [];
      }
      groupedStatuses[originalstatus.name].push(order.tracking);
    });
    if (unmapped.size > 0) {
      console.log("statuses not in status_groups_table:", [...unmapped]);
    }

    // Only orders we created (id exists) AND whose status wasn't already set to
    // retour. Manually-added dashboard parcels never match a row here.
    const retourId = statusNameToId["retour"];
    const ordersToReturn = await db
      .select({ orderId: ordersTable.id, borrowerId: ordersTable.borrowerId })
      .from(ordersTable)
      .where(
        and(
          inArray(ordersTable.id, groupedStatuses["retour"] || []),
          ne(ordersTable.statusId, retourId),
          // An Échange's own tracking goes to a return status when the swap
          // happens, so a return there says nothing about its Outgoing Pairs.
          // resolveEchanges decides it below (ADR-0009).
          ne(ordersTable.type, ECHANGE_TYPE),
        ),
      );

    let returnedCount = 0;
    if (ordersToReturn.length > 0) {
      const itemsToReturn = await db
        .select({
          shoeInventoryId: orderItems.shoeInventoryId,
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            ordersToReturn.map((o) => o.orderId),
          ),
        );

      await txClient().transaction(async (tx) => {
        for (const order of ordersToReturn) {
          // Flip the status in the same transaction as the movement, and only
          // if this sync is the one flipping it. The read above is outside any
          // transaction: on its own it lets a second sync running alongside
          // (the cron and the admin button) re-apply the movement, and so does
          // a later status write failing after this commits — the order would
          // still read as not returned next time.
          const claimed = await tx
            .update(ordersTable)
            .set({ statusId: retourId })
            .where(
              and(
                eq(ordersTable.id, order.orderId),
                ne(ordersTable.statusId, retourId),
              ),
            )
            .returning({ id: ordersTable.id });
          if (claimed.length === 0) continue;
          returnedCount++;

          const items = itemsToReturn
            .filter((it) => it.orderId === order.orderId)
            .map((it) => ({ inventoryId: it.shoeInventoryId, quantity: it.quantity }));

          if (items.length === 0) continue;

          await applyMovement(
            {
              reason: "retour",
              items,
              borrowerId: order.borrowerId ?? undefined,
              orderId: order.orderId,
            },
            tx,
          );
        }
      });
    }

    // changing the status of the orders in the db (only rows whose id matches).
    // The `ne` skips parcels already sitting on that status: providers return
    // every parcel every time, so without it this rewrites the whole table on
    // each sync and callers can't tell what actually moved.
    const updated = await Promise.all(
      Object.keys(groupedStatuses).map(async (statusName) => {
        const statusId = statusNameToId[statusName];
        if (!statusId) return [];
        return db
          .update(ordersTable)
          .set({ statusId })
          .where(
            and(
              inArray(ordersTable.id, groupedStatuses[statusName]),
              ne(ordersTable.statusId, statusId),
              // Delivered and returned Échanges are resolveEchanges' to decide.
              takesStatusFromOwnTracking(statusId),
            ),
          )
          .returning({ id: ordersTable.id });
      }),
    );

    const echanges = await resolveEchanges(groupedStatuses["retour"] ?? []);
    const echangesDecided = echanges.delivered.length + echanges.refused.length;

    revalidateStockPaths();

    return Response.json(
      {
        groupedStatuses,
        echanges,
        updatedCount: updated.flat().length + returnedCount + echangesDecided,
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("failed with this error ", error);
    return Response.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
