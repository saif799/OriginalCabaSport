import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/guard";
import {
  getEchangeStart,
  placeEchange,
  type EchangeDraft,
} from "@/lib/orders/echange";
import { revalidateStockPaths } from "@/lib/stock/revalidate";

/**
 * GET /api/admin/orders/echange?orderId=<tracking> — what the "Échanger"
 * dialog needs to start an Échange from that Original Order: its lines with
 * what is left to exchange, and every variant in stock to send instead.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getEchangeStart(orderId));
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to load the order: ${error}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/orders/echange — starts an Échange (body: `EchangeDraft`).
 * Sends the Outgoing Pairs through DHD and links the Returned Pairs to the
 * Original Order; see `placeEchange`.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const draft = (await request.json()) as EchangeDraft;
    const result = await placeEchange(draft);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    revalidateStockPaths();
    return NextResponse.json({ orderId: result.orderId });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to create the Échange: ${error}` },
      { status: 500 },
    );
  }
}
