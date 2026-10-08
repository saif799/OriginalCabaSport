"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useUrlParams } from "@/lib/hooks/useUrlParams";
import {
  EVENT_FAMILIES,
  FAMILY_META,
  type EventFamily,
} from "@/lib/stock/eventFamily";

/** Sentinel for "any Borrower" — a Select item cannot carry an empty value. */
const ANY_BORROWER = "any";

const chip =
  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors";

export function HistoryFilters({
  families,
  sizes,
  availableSizes,
  borrowers,
  borrowerId,
  from,
  to,
}: {
  families: EventFamily[];
  sizes: string[];
  /** Every size the selected colours have, in size order. */
  availableSizes: string[];
  borrowers: { id: string; name: string }[];
  borrowerId: string | null;
  from: string;
  to: string;
}) {
  const { isPending, setParams } = useUrlParams();

  /** Flips one value in a comma-separated param. Any filter change returns to page 1. */
  const toggleIn = (key: "families" | "sizes", current: string[], value: string) => {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setParams({ [key]: next.join(",") || null, page: null });
  };

  const isFiltered =
    families.length > 0 || sizes.length > 0 || !!borrowerId || !!from || !!to;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-xs text-muted-foreground">Event</span>
        {EVENT_FAMILIES.map((family) => {
          const active = families.includes(family);
          return (
            <button
              key={family}
              type="button"
              aria-pressed={active}
              onClick={() => toggleIn("families", families, family)}
              className={cn(
                chip,
                active
                  ? FAMILY_META[family].badge
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "mr-1.5 inline-block h-2 w-2 rounded-full align-middle",
                  FAMILY_META[family].bar,
                )}
              />
              {FAMILY_META[family].label}
            </button>
          );
        })}
      </div>

      {availableSizes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-xs text-muted-foreground">Size</span>
          {availableSizes.map((size) => {
            const active = sizes.includes(size);
            return (
              <button
                key={size}
                type="button"
                aria-pressed={active}
                onClick={() => toggleIn("sizes", sizes, size)}
                className={cn(
                  chip,
                  "tabular-nums",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {size}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-xs text-muted-foreground">Date</span>
        <Input
          type="date"
          aria-label="From"
          value={from}
          max={to || undefined}
          onChange={(event) =>
            setParams({ from: event.target.value || null, page: null })
          }
          className="w-auto"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label="To"
          value={to}
          min={from || undefined}
          onChange={(event) =>
            setParams({ to: event.target.value || null, page: null })
          }
          className="w-auto"
        />

        {borrowers.length > 0 && (
          <Select
            value={borrowerId ?? ANY_BORROWER}
            onValueChange={(value) =>
              setParams({
                borrower: value === ANY_BORROWER ? null : value,
                page: null,
              })
            }
          >
            <SelectTrigger className="w-[180px]" aria-label="Borrower">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_BORROWER}>Any borrower</SelectItem>
              {borrowers.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setParams({
                families: null,
                sizes: null,
                borrower: null,
                from: null,
                to: null,
                page: null,
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
