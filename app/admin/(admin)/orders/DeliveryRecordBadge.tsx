import { Badge } from "@/components/ui/badge";
import type { DeliveryRecord } from "@/lib/orders/deliveryRecord";

/**
 * The Delivery Record, as it appears under a customer's phone number on the
 * ready-to-ship queue: `2 ✓ · 1 ↩`, tinted by the record's state.
 *
 * Counts, not just a colour: one returned parcel and five returned parcels are
 * both red, and they are not the same customer. The state's own name is carried
 * in the tooltip rather than the badge so the cell stays narrow.
 */

const STYLE = {
  clean: {
    variant: "success",
    label: "Clean",
    // `success` is bg-green-400 behind the variant's own near-white text, which
    // lands around 2:1 — unreadable at 10px. Darkened here rather than in the
    // shared variant, whose look other badges may be relying on. `warning`
    // needs no such fix: it was added by this feature and is legible as it
    // ships. `destructive` is already white on a dark red.
    text: "text-green-950",
  },
  mixed: { variant: "warning", label: "Mixed", text: "" },
  poor: { variant: "destructive", label: "Poor", text: "" },
} as const;

export function DeliveryRecordBadge({ record }: { record: DeliveryRecord }) {
  const { state, delivered, returned } = record;
  const { variant, label, text } = STYLE[state];

  return (
    <Badge
      variant={variant}
      className={`mt-1 gap-1 px-1.5 py-0 text-[10px] font-semibold ${text}`}
      title={`${label}: ${delivered} delivered, ${returned} returned`}
    >
      <span>{delivered} ✓</span>
      <span aria-hidden="true">·</span>
      <span>{returned} ↩</span>
    </Badge>
  );
}
