import { db, type Executor } from "@/lib/db";
import { orderItems, shoeInventory, shoes, shoeModels } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { resolveProductPrice } from "@/lib/helpers";
import type { PixelContent } from "@/lib/storefront/pixel";

/**
 * The merchandise line items of an order, shaped the way Meta wants them.
 *
 * This exists because the SAME Purchase is reported twice — once from the
 * browser by `PurchaseTracker`, once from the server by `lib/storefront/capi`
 * — and Meta deduplicates the pair on (event_name, event_id) while keeping
 * whichever arrived first. If the two carried different `value`s, which number
 * ends up in Ads Manager would depend on a race. So both read from here.
 *
 * `value` is merchandise only. `ordersTable.montant` carries the DHD tarif on
 * top, and that swings by wilaya — reporting it would have Meta bid on how far
 * away a customer lives. Prices use the same 3-level root-to-leaf resolution
 * the storefront sells at (see ADR-0002), not a stored snapshot: the order
 * table keeps no per-line price.
 */
export type PurchaseContents = {
  contents: PixelContent[];
  /** Deduplicated colour-variant ids — one Meta "product" per variant. */
  contentIds: string[];
  value: number;
  numItems: number;
};

export async function getPurchaseContents(
  orderId: string,
  exec: Executor = db,
): Promise<PurchaseContents> {
  const rows = await (exec as typeof db)
    .select({
      shoeId: shoes.id,
      quantity: orderItems.quantity,
      modelBasePrice: shoeModels.basePrice,
      shoePriceOverride: shoes.priceOverride,
      sizePriceOverride: shoeInventory.priceOverride,
    })
    .from(orderItems)
    .innerJoin(shoeInventory, eq(orderItems.shoeInventoryId, shoeInventory.id))
    .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .where(eq(orderItems.orderId, orderId));

  const contents: PixelContent[] = rows.map((row) => ({
    id: row.shoeId,
    quantity: row.quantity,
    item_price: resolveProductPrice(
      row.modelBasePrice,
      row.shoePriceOverride,
      row.sizePriceOverride,
    ),
  }));

  return {
    contents,
    contentIds: [...new Set(contents.map((c) => c.id))],
    value: contents.reduce((sum, c) => sum + c.item_price * c.quantity, 0),
    numItems: contents.reduce((sum, c) => sum + c.quantity, 0),
  };
}
