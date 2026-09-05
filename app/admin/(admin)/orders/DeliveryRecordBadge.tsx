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

const VARIANT = {
  clean: "success",
  mixed: "warning",
  poor: "destructive",
} as const;

const LABEL = {
  clean: "Clean",
  mixed: "Mixed",
  poor: "Poor",
} as const;

/**
 * `success` (green-400) and `warning` (amber-500) are both light enough that
 * their variants' near-white text lands around 2:1 against them — unreadable at
 * 10px. Darkened here rather than in the shared variants, whose look other
 * badges may be relying on. `destructive` is already white on a dark red.
 */
const TEXT = {
  clean: "text-green-950",
  mixed: "text-amber-950",
  poor: "",
} as const;

export function DeliveryRecordBadge({ record }: { record: DeliveryRecord }) {
  const { state, delivered, returned } = record;

  return (
    <Badge
      variant={VARIANT[state]}
      className={`mt-1 gap-1 px-1.5 py-0 text-[10px] font-semibold ${TEXT[state]}`}
      title={`${LABEL[state]}: ${delivered} delivered, ${returned} returned`}
    >
      <span>{delivered} ✓</span>
      <span aria-hidden="true">·</span>
      <span>{returned} ↩</span>
    </Badge>
  );
}
