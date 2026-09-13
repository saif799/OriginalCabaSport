import { formatDZD } from "@/lib/format";
import { phoneKey } from "@/lib/orders/phone";

/**
 * The "your parcel is out for delivery" WhatsApp nudge: turning one order and
 * one editable template into a `wa.me` link the admin can tap.
 *
 * It is a `wa.me` deep link, not an API call — the message is composed here and
 * handed to the owner's own WhatsApp, where a human presses Send. Nothing here
 * sends anything, and nothing ever learns whether the message arrived. That is
 * the whole reason `orders.confirmation_sent_at` records an intent rather than
 * a delivery.
 *
 * Every function here is pure so the two ways this quietly goes wrong — a
 * literal `{price}` in a sent message, or a link to somebody else's number —
 * are covered by `tests/orders/whatsappMessage.test.ts` and not by noticing it
 * on a customer's phone.
 */

/**
 * The template a shop that has never edited one gets. Darja, because it is read
 * in one pass by the people receiving it, and deliberately anonymous: no name,
 * no tracking reference. The reference is withheld until there is a tracking
 * page on our own site to point it at.
 */
export const DEFAULT_DELIVERY_MESSAGE =
  "السلام عليكم، طلبيتك وصلات و راه يتصل بيك الليفرور في أي وقت.\n" +
  "المبلغ اللي تخلص: {price}\n" +
  "بارك الله فيك.";

/** The one token a template may interpolate. Anything else is literal text. */
const PRICE_TOKEN = /\{price\}/g;

/**
 * The template with `{price}` replaced by the order's `montant`, formatted.
 *
 * `montant` is the full amount the customer hands the livreur — merchandise
 * *plus* the courier's tarif — which is exactly why the Conversions API is
 * forbidden from using it and exactly what belongs in this message.
 *
 * A `montant` that isn't a number renders as nothing rather than `NaN DA`. The
 * column is a provider-shaped varchar that has held `""`, and a visibly missing
 * price in the preview dialog is a better failure than a confident wrong one on
 * the customer's phone.
 *
 * Unknown tokens are left exactly as written: a mistyped `{pirce}` arriving
 * verbatim is obvious, where silently deleting it would send a message with no
 * price in it at all.
 */
export function renderDeliveryMessage(
  template: string,
  montant: string | null | undefined,
): string {
  const amount = Number(montant);
  const price =
    montant != null && montant.trim() !== "" && Number.isFinite(amount)
      ? formatDZD(amount)
      : "";
  return template.replace(PRICE_TOKEN, price);
}

/**
 * A stored phone number as WhatsApp addresses it: `213` + the national core.
 *
 * Built on `phoneKey` rather than a local regex so it inherits the one rule
 * that matters — an Algiers landline (`021 34 56 78`) already *starts* with
 * `213` once its leading zero is gone, and must not have six digits eaten. See
 * the header of `lib/orders/phone.ts`.
 *
 * Null when there is nothing numeric to dial, so a caller cannot build a link
 * to `https://wa.me/213`.
 */
export function whatsAppPhone(raw: string | null | undefined): string | null {
  const core = phoneKey(raw);
  return core ? `213${core}` : null;
}

/**
 * The `wa.me` link for one customer and one rendered message, or null if the
 * order carries no usable number.
 *
 * `wa.me` rather than `web.whatsapp.com/send`: this is pressed from a phone,
 * where the universal link hands off to the WhatsApp app directly and the
 * desktop interstitial never appears.
 */
export function buildWhatsAppLink(
  telephone: string | null | undefined,
  message: string,
): string | null {
  const phone = whatsAppPhone(telephone);
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
