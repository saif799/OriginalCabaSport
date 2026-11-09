import { requireAdmin } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { borrower } from "@/lib/schema";
import { revalidateStockPaths } from "@/lib/stock/revalidate";
import { asc, sql } from "drizzle-orm";

const MAX_NAME_LENGTH = 80;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const borrowers = await db
      .select({
        id: borrower.id,
        name: borrower.name,
      })
      .from(borrower)
      .orderBy(asc(borrower.name));

    return Response.json(borrowers);
  } catch (error) {
    console.error("Failed to fetch borrowers:", error);
    return Response.json({ error: "Failed to fetch borrowers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json();
    const name = body?.name;

    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    if (cleanName.length > MAX_NAME_LENGTH) {
      return Response.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const [clash] = await db
      .select({ id: borrower.id })
      .from(borrower)
      .where(sql`LOWER(${borrower.name}) = LOWER(${cleanName})`)
      .limit(1);

    if (clash) {
      return Response.json(
        { error: "A borrower with that name already exists" },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(borrower)
      .values({ name: cleanName })
      .returning();

    revalidateStockPaths(created.id);

    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error("Failed to create borrower:", error);
    return Response.json({ error: "Failed to create borrower" }, { status: 500 });
  }
}
