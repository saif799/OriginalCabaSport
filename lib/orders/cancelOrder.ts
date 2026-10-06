import { db, txClient, type Executor } from "@/lib/db";
import { echangeReturns, orderItems, ordersTable } from "@/lib/schema";
import { applyMovement } from "@/lib/stock/movement";
import { getProvider, type DeliveryProvider } from "@/lib/delivery";
import { CANCELED_STATUS_ID, READY_TO_SHIP_STATUS_ID } from "@/lib/orders/status";
import { ECHANGE_TYPE } from "@/lib/orders/orderType";
import { eq } from "drizzle-orm";

export type CancelOrderResult =
  | { ok: true; borrowerId: string | null }
  | { ok: false; status: number; error: string };

export type CancelOrderDeps = {
  /** Reaches the courier. Defaults to the order's own provider; tests pass a fake. */
  provider?: DeliveryProvider;
  /** Defaults to opening its own `txClient().transaction()`; tests pass a test-db handle. */
  exec?: Executor;
};

/**
 * Cancels the parcel with its courier and — only once the courier confirms —
 * marks the order cancelled and puts its pairs back, atomically. Cancelling an
 * Échange also deletes its links, so the Original Order's pairs it was taking
 * back become exchangeable again.
 */
export async function cancelOrder(
  orderId: string,
  deps: CancelOrderDeps = {},
): Promise<CancelOrderResult> {
  const readExec = (deps.exec ?? db) as typeof db;

  const [order] = await readExec
    .select({
      provider: ordersTable.provider,
      borrowerId: ordersTable.borrowerId,
      type: ordersTable.type,
      statusId: ordersTable.statusId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!order) {
    return { ok: false, status: 404, error: "Order not found." };
  }

  // Once an Échange ships, the sync is what settles its stock (ADR-0009): a
  // cancel on top of a swap's restock, or a refusal's, would count it twice.
  if (order.type === ECHANGE_TYPE && order.statusId !== READY_TO_SHIP_STATUS_ID) {
    return {
      ok: false,
      status: 400,
      error: "An Échange can only be cancelled while it is ready to ship.",
    };
  }

  const provider = deps.provider ?? getProvider(order.provider);

  let deletion;
  try {
    deletion = await provider.deleteOrder(orderId);
  } catch (providerError) {
    console.log("provider failed to delete order", providerError);
    return {
      ok: false,
      status: 502,
      error: `Failed to delete order: ${(providerError as Error).message}`,
    };
  }

  if (!deletion.ok) {
    return { ok: false, status: 500, error: "Provider failed to delete order" };
  }

  const items = await readExec
    .select({
      inventoryId: orderItems.shoeInventoryId,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  async function persist(exec: Executor) {
    const e = exec as typeof db;
    await e
      .update(ordersTable)
      .set({ statusId: CANCELED_STATUS_ID })
      .where(eq(ordersTable.id, orderId));

    // No rows unless this is an Échange.
    await e.delete(echangeReturns).where(eq(echangeReturns.echangeId, orderId));

    await applyMovement(
      {
        reason: "cancel",
        items,
        borrowerId: order.borrowerId ?? undefined,
        orderId,
      },
      exec,
    );
  }

  if (deps.exec) {
    await persist(deps.exec);
  } else {
    await txClient().transaction((tx) => persist(tx));
  }

  return { ok: true, borrowerId: order.borrowerId };
}
