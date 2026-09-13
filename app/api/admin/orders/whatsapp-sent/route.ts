import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ordersTable } from "@/lib/schema";

/**
 * POST /api/admin/orders/whatsapp-sent — stamps `confirmation_sent_at` on one
 * order. Body: `{ orderId: string }`.
 *
 * What it records is that the admin opened the message in WhatsApp, not that
 * WhatsApp delivered it: a `wa.me` link reports nothing back, ever. The caller
 * fires this alongside the link rather than awaiting it, because awaiting would
 * move the WhatsApp open out of the tap gesture and get it blocked on mobile —
 * so this request failing is a normal outcome, and it costs a missing badge,
 * nothing more.
 *
 * The stamp is never cleared, including when `/api/status` later moves the
 * order to Livre or retour. It means "last messaged about this parcel", and the
 * button stays available regardless, so a stale badge costs nothing.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    const sentAt = new Date();
    const [updated] = await db
      .update(ordersTable)
      .set({ confirmationSentAt: sentAt })
      .where(eq(ordersTable.id, orderId))
      .returning({ id: ordersTable.id });

    if (!updated) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    revalidatePath("/admin/orders");
    return NextResponse.json({ success: true, confirmationSentAt: sentAt });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
