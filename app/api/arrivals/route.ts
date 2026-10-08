import { requireAdmin } from "@/lib/auth/guard";
import { db, txClient } from "@/lib/db";
import { arrivalItems, arrivals } from "@/lib/schema";
import { revalidateStockPaths } from "@/lib/stock/revalidate";
import { ArrivalError, saveArrival } from "@/lib/arrivals/saveArrival";
import { desc, eq, sql } from "drizzle-orm";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const rows = await db
      .select({
        id: arrivals.id,
        reference: arrivals.reference,
        note: arrivals.note,
        createdAt: arrivals.createdAt,
        variantCount: sql<number>`count(${arrivalItems.id})`.mapWith(Number),
        totalPairs:
          sql<number>`coalesce(sum(${arrivalItems.quantity}), 0)`.mapWith(
            Number,
          ),
      })
      .from(arrivals)
      .leftJoin(arrivalItems, eq(arrivalItems.arrivalId, arrivals.id))
      .groupBy(arrivals.id)
      .orderBy(desc(arrivals.createdAt));

    return Response.json(rows);
  } catch (error) {
    console.error("Failed to fetch arrivals:", error);
    return Response.json(
      { error: "Failed to fetch arrivals" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json();

    // Reads included: the duplicate guard has to see the same colours the
    // inserts will sit beside. An arrivage never writes a price — that belongs
    // to the model (ADR-0002).
    const { arrivalId, created } = await txClient().transaction((tx) =>
      saveArrival(
        { reference: body?.reference, note: body?.note, lines: body?.lines },
        tx,
      ),
    );

    revalidateStockPaths();
    return Response.json({ success: true, arrivalId, created });
  } catch (error) {
    if (error instanceof ArrivalError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to save arrival:", error);
    return Response.json({ error: "Failed to save arrival" }, { status: 500 });
  }
}
