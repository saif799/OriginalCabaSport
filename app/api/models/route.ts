import { requireAdmin } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { shoeModels } from "@/lib/schema";
import { asc, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    // Feeds the add-shoes model picker. Archived models are listed too, after
    // the live ones: withholding them made restocking one impossible — its
    // name is taken, so creating it again 409s.
    const models = await db
      .select()
      .from(shoeModels)
      .orderBy(asc(shoeModels.archived), asc(shoeModels.modelName));
    return Response.json(models);
  } catch (error) {
    return Response.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { modelName, basePrice, compareAtPrice } = await request.json();
    const name = typeof modelName === "string" ? modelName.trim() : "";

    if (!name) {
      return Response.json(
        { error: "Model name is required" },
        { status: 400 }
      );
    }

    // Both prices are optional: a model created without one is unpriced, and
    // stays off the storefront until it is priced in /admin/products.
    const isPrice = (v: unknown): v is number =>
      typeof v === "number" && Number.isInteger(v) && v >= 0;
    if (
      (basePrice != null && !isPrice(basePrice)) ||
      (compareAtPrice != null && !isPrice(compareAtPrice))
    ) {
      return Response.json(
        { error: "Prices must be whole numbers of DA, 0 or more" },
        { status: 400 }
      );
    }

    // Caught here as well as on rename: a guard that only fires when correcting
    // a typo is a guard that arrives too late to prevent the duplicate.
    const [clash] = await db
      .select({
        modelName: shoeModels.modelName,
        archived: shoeModels.archived,
      })
      .from(shoeModels)
      .where(ilike(shoeModels.modelName, name))
      .limit(1);

    if (clash) {
      return Response.json(
        {
          error: clash.archived
            ? `"${clash.modelName}" already exists as an archived model — pick it from the list`
            : `A model named "${clash.modelName}" already exists`,
        },
        { status: 409 }
      );
    }

    const [inserted] = await db
      .insert(shoeModels)
      .values({
        modelName: name,
        ...(basePrice != null ? { basePrice } : {}),
        compareAtPrice: compareAtPrice ?? null,
      })
      .returning();

    revalidatePath("/admin");
    revalidatePath("/admin/add-shoes");

    return Response.json(inserted);
  } catch (error) {
    return Response.json({ error: "Failed to create model" }, { status: 500 });
  }
}
