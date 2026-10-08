import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  FAMILY_META,
  eventSubLabel,
  movesLocationOnly,
  type EventFamily,
} from "@/lib/stock/eventFamily";
import { SHOP_TZ, type HistoryEvent, type HistorySize } from "@/lib/stock/history";
import { statusBadgeClass } from "@/lib/orders/status";
import { ALL_STATUSES } from "@/app/admin/(admin)/orders/params";

// Formatted on the server in the shop's zone, so a row reads the same from a
// phone abroad as from the till — and never mismatches on hydration.
const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const signed = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "±0";

/** The pairs one size contributed to an event, as the family counts them. */
function sizeUnits(family: EventFamily, size: HistorySize): number {
  return movesLocationOnly(family)
    ? Math.abs(size.lendedDelta)
    : Math.abs(size.delta);
}

function movedLabel(event: HistoryEvent): string {
  const who = event.borrower?.name ?? "borrower";
  if (event.family === "lent") return `${event.units} → ${who}`;
  if (event.family === "brought-back") return `${event.units} ← ${who}`;
  return signed(event.units);
}

export function HistoryTimeline({ events }: { events: HistoryEvent[] }) {
  return (
    <ul className="overflow-hidden rounded-md border divide-y">
      {events.map((event) => (
        <TimelineRow key={`${event.groupId}:${event.shoeId}`} event={event} />
      ))}
    </ul>
  );
}

function TimelineRow({ event }: { event: HistoryEvent }) {
  const meta = FAMILY_META[event.family];
  const subLabel = eventSubLabel(
    event.reason,
    event.order !== null,
    event.borrower?.name,
  );
  const showsStock = !movesLocationOnly(event.family);
  const single = event.sizes.length === 1 ? event.sizes[0] : null;

  return (
    <li className={cn("flex", event.reconstructed && "bg-muted/30")}>
      <span className={cn("w-1 shrink-0", meta.bar)} aria-hidden />
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />

          <span
            className="w-36 shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums"
            title={
              event.reconstructed
                ? "Reconstructed from older records, and shown to the day."
                : undefined
            }
          >
            {event.reconstructed
              ? dateOnly.format(event.occurredAt)
              : dateTime.format(event.occurredAt)}
          </span>

          <span className="flex w-44 shrink-0 items-center gap-1.5">
            <Badge className={meta.badge}>{meta.label}</Badge>
            {subLabel && (
              <span className="truncate text-xs text-muted-foreground">
                {subLabel}
              </span>
            )}
          </span>

          <span className="min-w-40 flex-1 truncate">
            <span className="font-medium">{event.modelName}</span>{" "}
            <span className="text-muted-foreground">— {event.color}</span>
          </span>

          <span className="flex flex-wrap gap-1">
            {event.sizes.map((size) => (
              <span
                key={size.size}
                className="rounded border bg-background px-1.5 py-0.5 text-xs tabular-nums"
              >
                {size.size}
                <span className="text-muted-foreground">
                  ×{sizeUnits(event.family, size)}
                </span>
              </span>
            ))}
          </span>

          <span
            className={cn(
              "w-28 shrink-0 text-right font-semibold tabular-nums",
              meta.text,
            )}
          >
            {movedLabel(event)}
          </span>

          <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {showsStock && single && single.quantityAfter !== null
              ? `${single.quantityAfter} in stock`
              : null}
          </span>

          <span className="flex w-64 shrink-0 flex-wrap items-center justify-end gap-1.5">
            {event.oversold && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
                title="Asked for more pairs than the stock held — the count stopped at zero."
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                oversold
              </span>
            )}
            {event.reconstructed && (
              <span className="text-xs italic text-muted-foreground">
                reconstructed
              </span>
            )}
            <SourceLink event={event} />
          </span>
        </summary>

        <div className="space-y-2 border-t bg-muted/20 px-3 py-2.5 pl-11 text-sm">
          {event.note && (
            <p>
              <span className="text-muted-foreground">Note:</span> {event.note}
            </p>
          )}
          <table className="text-xs tabular-nums">
            <tbody>
              {event.sizes.map((size) => (
                <SizeLine
                  key={size.size}
                  event={event}
                  size={size}
                  showsStock={showsStock}
                />
              ))}
            </tbody>
          </table>
          {event.reconstructed && (
            <p className="text-xs text-muted-foreground">
              Rebuilt from records older than the stock history. Nothing kept
              the stock level at the time, so only the movement is shown.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

function SizeLine({
  event,
  size,
  showsStock,
}: {
  event: HistoryEvent;
  size: HistorySize;
  showsStock: boolean;
}) {
  const units = sizeUnits(event.family, size);
  const short = event.family === "sold" && size.requested > units;

  return (
    <tr>
      <td className="pr-4 text-muted-foreground">Size {size.size}</td>
      <td className="pr-4 font-medium">
        {showsStock ? signed(size.delta) : `${units} pair${units === 1 ? "" : "s"}`}
      </td>
      <td className="pr-4 text-muted-foreground">
        {size.quantityBefore !== null && size.quantityAfter !== null
          ? showsStock
            ? `${size.quantityBefore} → ${size.quantityAfter} in stock`
            : `${size.quantityAfter} in stock, unchanged`
          : null}
      </td>
      {short && (
        <td className="font-medium text-amber-700">
          asked for {size.requested}, held {units}
        </td>
      )}
    </tr>
  );
}

/** Where the movement came from: its order, its arrivage, or its Borrower. */
function SourceLink({ event }: { event: HistoryEvent }) {
  const link = "text-xs underline underline-offset-2 hover:text-foreground";

  if (event.order) {
    return (
      <>
        <Link
          href={`/admin/orders?status=${ALL_STATUSES}&q=${encodeURIComponent(event.order.id)}`}
          className={cn(link, "max-w-28 truncate")}
          title={event.order.id}
        >
          {event.order.id}
        </Link>
        {/* The order's status today — on a reconstructed sale this is the
            only trace of whether the pairs came back. */}
        <Badge
          variant="outline"
          className={statusBadgeClass(event.order.statusId)}
          title="The order's status now"
        >
          {event.order.statusName ?? "Unknown"}
        </Badge>
      </>
    );
  }
  if (event.arrival) {
    return (
      <Link href="/admin/arrivals" className={link}>
        {event.arrival.reference || "Arrivage"}
      </Link>
    );
  }
  if (event.borrower) {
    return (
      <Link href={`/admin/borrowers/${event.borrower.id}`} className={link}>
        {event.borrower.name}
      </Link>
    );
  }
  return null;
}
