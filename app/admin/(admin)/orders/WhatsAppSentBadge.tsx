import { Badge } from "@/components/ui/badge";

/**
 * "Messaged 14:20", under a customer's phone number on an `en livraison` row.
 *
 * Shares the slot with `DeliveryRecordBadge`, which never appears here: the
 * Delivery Record is resolved only for ready-to-ship rows, because it answers
 * "should I send this?" — a question a parcel already with the livreur has
 * answered. The two badges cannot collide.
 *
 * Time only, not the date. It is read while working through today's parcels,
 * where the useful question is whether this one has been done in this sitting;
 * the full timestamp is in the dialog for the rare case the answer is "no, days
 * ago".
 */
export function WhatsAppSentBadge({ sentAt }: { sentAt: Date | string }) {
  const date = new Date(sentAt);
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Badge
      variant="secondary"
      className="mt-1 gap-1 px-1.5 py-0 text-[10px] font-semibold"
      title={`WhatsApp message opened ${date.toLocaleString()}`}
    >
      <span aria-hidden="true">✓</span>
      <span>{time}</span>
    </Badge>
  );
}
