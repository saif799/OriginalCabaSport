import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/guard";
import { DEFAULT_DELIVERY_MESSAGE } from "@/lib/orders/whatsappMessage";
import {
  WHATSAPP_DELIVERY_MESSAGE_KEY,
  getSetting,
  setSetting,
} from "@/lib/settings/appSettings";

/**
 * The editable template behind the orders-page WhatsApp nudge.
 *
 * Fetched when the send dialog opens rather than rendered into the orders page:
 * the template is wanted on the small fraction of page loads where the button
 * is actually pressed, and `/admin/orders` already pays for four queries on
 * neon-http, where each statement is its own round trip.
 */

/** GET — the saved template, or the shipped default if it was never edited. */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const message = await getSetting(
      WHATSAPP_DELIVERY_MESSAGE_KEY,
      DEFAULT_DELIVERY_MESSAGE,
    );
    return NextResponse.json({ message });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}

/**
 * PUT — saves a new default. Body: `{ message: string }`.
 *
 * An empty template is rejected rather than stored: it would leave the dialog
 * blank with no way back to the default short of editing the database, since
 * the fallback only applies to a row that does not exist.
 */
export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message : "";
    if (message.trim() === "") {
      return NextResponse.json(
        { error: "Message cannot be empty" },
        { status: 400 },
      );
    }

    await setSetting(WHATSAPP_DELIVERY_MESSAGE_KEY, message);
    return NextResponse.json({ message });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
