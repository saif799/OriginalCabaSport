import { requireAdmin } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { shoeModels } from "@/lib/schema";
import { revalidateStockPaths } from "@/lib/stock/revalidate";
import { placeOrder, type OrderDraft } from "@/lib/orders/placeOrder";
import { cancelOrder } from "@/lib/orders/cancelOrder";
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

    const result = await cancelOrder(orderId);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    revalidateStockPaths(result.borrowerId ?? undefined);

    return Response.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.log(error);
    return Response.json(
      { error: `Failed to delete order: ${error}` },
      { status: 500 }
    );
  }
}
