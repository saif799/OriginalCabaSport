import { requireAdmin } from "@/lib/auth/guard";
import { db, txClient } from "@/lib/db";
import { shoeInventory } from "@/lib/schema";
import { applyMovement } from "@/lib/stock/movement";
import { revalidateStockPaths } from "@/lib/stock/revalidate";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const inventory = await db.select().from(shoeInventory);
    return Response.json(inventory);
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}

/** One of the sizes named in the request does not exist; nothing was saved. */
class UnknownSize extends Error {}

type CorrectedSize = { inventoryId: string; quantity: number };

function isCorrectedSize(item: unknown): item is CorrectedSize {
  const { inventoryId, quantity } = (item ?? {}) as Partial<CorrectedSize>;
  return (
    typeof inventoryId === "string" &&
    inventoryId.length > 0 &&
    Number.isInteger(quantity) &&
    (quantity as number) >= 0
  );
}

/**
 * Corrects the count of one or more sizes — what EditInventoryDialog saves.
 * One request is one `correction` Stock Movement, so the sizes save or fail
 * together and the stock history shows a single event carrying the note.
 */
export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { items, note } = await request.json();

    if (!Array.isArray(items) || items.length === 0 || !items.every(isCorrectedSize)) {
      return Response.json(
        { error: "Each size needs an id and a quantity of 0 or more" },
        { status: 400 },
      );
    }

    const { updated } = await txClient().transaction(async (tx) => {
      const result = await applyMovement(
        {
          reason: "correction",
          items: items.map((item) => ({
            inventoryId: item.inventoryId,
            newQuantity: item.quantity,
          })),
          note: typeof note === "string" ? note : undefined,
        },
        tx,
      );
      // Thrown, not returned: the sizes that did exist must roll back too.
      if (result.updated.length !== items.length) throw new UnknownSize();
      return result;
    });

    revalidateStockPaths();
    return Response.json({ updated });
  } catch (error) {
    if (error instanceof UnknownSize) {
      return Response.json({ error: "Item not found" }, { status: 404 });
    }
    console.log("Failed to update inventory", error);
    return Response.json(
      { error: "Failed to update inventory" },
      { status: 500 },
    );
  }
}
