import { cn } from "@/lib/utils";
import { FAMILY_META } from "@/lib/stock/eventFamily";
import type { HistorySummary } from "@/lib/stock/history";

/**
 * One card per selected colour. The first three numbers are sums over the
 * ledger and follow the filters; the last two are read live and do not — "in
 * stock now" means now, whatever date range is on screen.
 */
export function SummaryStrip({
  summaries,
  filtered,
}: {
  summaries: HistorySummary[];
  /** A filter is narrowing the ledger sums, so they are not lifetime totals. */
  filtered: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {summaries.map((summary) => (
        <div key={summary.shoeId} className="rounded-md border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {summary.modelName}{" "}
              <span className="text-muted-foreground">— {summary.color}</span>
            </p>
            {filtered && (
              <span className="shrink-0 text-xs text-muted-foreground">
                in view
              </span>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-5 gap-2 text-center">
            <Stat label="Arrived" value={summary.arrived} className={FAMILY_META.arrived.text} />
            <Stat label="Sold" value={summary.sold} className={FAMILY_META.sold.text} />
            <Stat
              label="Came back"
              value={summary.cameBack}
              className={FAMILY_META["came-back"].text}
            />
            <Stat
              label="At borrowers"
              value={summary.atBorrowers}
              className={FAMILY_META.lent.text}
              now
            />
            {/* Physical Quantity: the pairs at borrowers are part of it, not beside it. */}
            <Stat
              label="In stock"
              value={summary.inStock}
              now
              title="Every pair owned, including the ones at borrowers"
            />
          </dl>
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  className,
  now,
  title,
}: {
  label: string;
  value: number;
  className?: string;
  now?: boolean;
  title?: string;
}) {
  return (
    <div className={cn(now && "border-l")} title={title}>
      <dd className={cn("text-lg font-semibold tabular-nums", className)}>
        {value}
      </dd>
      <dt className="text-[11px] leading-tight text-muted-foreground">
        {label}
        {now && <span className="block">now</span>}
      </dt>
    </div>
  );
}
