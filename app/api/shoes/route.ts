import { requireAdmin } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { shoeInventory, shoes } from "@/lib/schema";
import { findMalformedModelIds } from "@/lib/arrivals/validate";
import type { ModelColour } from "@/lib/arrivals/form";
import { asc, eq } from "drizzle-orm";

/**
 * One model's colours for the add-shoes form: `GET /api/shoes?modelId=<uuid>`.
 *
 * Archived colours are included (the form labels them) — withholding them is
 * what let a restock create a second Product of the same name. Quantities are
 * Physical Quantity, not Store-Held Stock: an arrivage adds to what exists,
 * wherever it is kept.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const modelId = new URL(request.url).searchParams.get("modelId");
  if (!modelId || findMalformedModelIds([modelId]).length) {
    return Response.json({ error: "A valid modelId is required" }, { status: 400 });
  }

  try {
    const rows = await db
      .select({
        id: shoes.id,
        color: shoes.color,
        archived: shoes.archived,
        size: shoeInventory.size,
        quantity: shoeInventory.quantity,
      })
      .from(shoes)
      .leftJoin(shoeInventory, eq(shoeInventory.shoeId, shoes.id))
      .where(eq(shoes.modelId, modelId))
      .orderBy(asc(shoes.archived), asc(shoes.color));

    const colours = new Map<string, ModelColour>();
    for (const row of rows) {
      let colour = colours.get(row.id);
      if (!colour) {
        colour = { id: row.id, color: row.color, archived: row.archived, sizes: [] };
        colours.set(row.id, colour);
      }
      if (row.size != null) {
        colour.sizes.push({ size: row.size, quantity: row.quantity ?? 0 });
      }
    }

    return Response.json(Array.from(colours.values()));
  } catch (error) {
    console.error("Failed to fetch colours:", error);
    return Response.json({ error: "Failed to fetch colours" }, { status: 500 });
  }
}
