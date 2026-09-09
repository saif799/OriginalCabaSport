import { requireAdmin } from "@/lib/auth/guard";
import { db, txClient } from "@/lib/db";
import { orderItems, ordersTable, shoeModels } from "@/lib/schema";
import { applyMovement } from "@/lib/stock/movement";
import { revalidateStockPaths } from "@/lib/stock/revalidate";
import { CANCELED_STATUS_ID } from "@/lib/orders/status";
import { placeOrder, type OrderDraft } from "@/lib/orders/placeOrder";
import { getProvider } from "@/lib/delivery";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { capiSignalsFromRequest, sendPurchaseEvent } from "@/lib/storefront/capi";
import { getPurchaseContents } from "@/lib/storefront/purchaseContents";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const models = await db.select().from(shoeModels);
    return Response.json(models);
  } catch (error) {
    return Response.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const draft = (await request.json()) as OrderDraft;
    const result = await placeOrder(draft);

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    revalidateStockPaths(draft.borrowerId ?? undefined);

    // Report the sale to Meta from the server, mirroring the browser Purchase
    // that `PurchaseTracker` fires on the confirmation page. Storefront orders
    // only: an order typed into an admin form did not come from an ad, and
    // feeding it back would train delivery on traffic Meta never sent.
    //
    // `after()` runs this once the response is on its way, so the customer
    // waits on the courier and the database, never on graph.facebook.com — but
    // unlike a floating promise it keeps the serverless function alive until
    // the call finishes.
    if (draft.source === "storefront") {
      const signals = capiSignalsFromRequest(request);
      const orderId = result.orderId;
      after(async () => {
        // `sendPurchaseEvent` swallows its own failures, but the price lookup
        // does not — and a thrown error here would be an unhandled rejection
        // over an order that already succeeded.
        try {
          const { contents, contentIds, value, numItems } =
            await getPurchaseContents(orderId);
          await sendPurchaseEvent({
            // The order id, so Meta dedupes this against the browser event.
            eventId: orderId,
            value,
            contentIds,
            contents,
            numItems,
            eventSourceUrl: signals.eventSourceUrl,
            user: {
              phone: draft.telephone,
              fbp: signals.fbp,
              fbc: signals.fbc,
              clientIpAddress: signals.clientIpAddress,
              clientUserAgent: signals.clientUserAgent,
            },
          });
        } catch (capiError) {
          console.error(`[capi] Purchase ${orderId} not reported:`, capiError);
        }
      });
    }

    return Response.json({
      message: "Order created successfully",
      orderId: result.orderId,
    });
  } catch (error) {
    return Response.json(
      { error: `Failed to create order ${error}` },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { orderId } = await request.json();

    if (!orderId) {
      return Response.json({ error: "order ID is required." }, { status: 400 });
    }

    const [order] = await db
      .select({
        provider: ordersTable.provider,
        borrowerId: ordersTable.borrowerId,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (!order) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    const provider = getProvider(order.provider);

    let deletion;
    try {
      deletion = await provider.deleteOrder(orderId);
    } catch (providerError) {
      console.log("provider failed to delete order", providerError);
      return Response.json(
        { error: `Failed to delete order: ${(providerError as Error).message}` },
        { status: 502 }
      );
    }

    if (!deletion.ok) {
      return Response.json(
        { error: "Provider failed to delete order" },
        { status: 500 }
      );
    }

    const items = await db
      .select({
        inventoryId: orderItems.shoeInventoryId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    await txClient().transaction(async (tx) => {
      await tx
        .update(ordersTable)
        .set({ statusId: CANCELED_STATUS_ID })
        .where(eq(ordersTable.id, orderId));

      await applyMovement(
        {
          reason: "cancel",
          items,
          borrowerId: order.borrowerId ?? undefined,
          orderId,
        },
        tx,
      );
    });

    revalidateStockPaths(order.borrowerId ?? undefined);

    return Response.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.log(error);
    return Response.json(
      { error: `Failed to delete order: ${error}` },
      { status: 500 }
    );
  }
}
