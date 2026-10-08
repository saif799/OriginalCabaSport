import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ArrivalSize } from "@/lib/arrivals/form";
import { cn } from "@/lib/utils";

export interface AddedShoeCardProps {
  modelName: string;
  color: string;
  /** Each size with its own quantity, in the order they should read. */
  sizes: ArrivalSize[];
  /** The arrivage will create this colour. */
  isNew?: boolean;
  /** This line is the one loaded in the form. */
  active?: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

/** One line of the arrivage: a colour and what arrived of it, size by size. */
export default function AddedShoeCard({
  modelName,
  color,
  sizes,
  isNew,
  active,
  onSelect,
  onRemove,
}: AddedShoeCardProps) {
  const pairs = sizes.reduce((sum, s) => sum + s.quantity, 0);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-start gap-1 rounded-lg border bg-card text-card-foreground shadow-xs transition-colors",
        active && "border-primary ring-1 ring-primary/40",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Edit ${modelName} ${color}`}
        aria-current={active ? "true" : undefined}
        className="min-w-0 flex-1 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{modelName}</span>
          {isNew && (
            <Badge variant="secondary" className="shrink-0">
              new colour
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {pairs} pair{pairs === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{color}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {sizes.map((s) => (
            <li
              key={s.size}
              className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums"
            >
              {s.size}
              <span className="text-muted-foreground">×</span>
              {s.quantity}
            </li>
          ))}
        </ul>
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${modelName} ${color} from the arrivage`}
        className="m-1.5 shrink-0 rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
