"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown, Loader2, X } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useUrlParams } from "@/lib/hooks/useUrlParams";

export type HistoryShoeOption = {
  shoeId: string;
  modelId: string;
  modelName: string;
  color: string;
  /** Archived colours are still pickable — their history is exactly why you'd look. */
  archived: boolean;
};

/** Case- and accent-insensitive haystack, as the Collections picker searches. */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** More than this and the list is asking to be searched, not scrolled. */
const MAX_VISIBLE = 80;

export function ShoeMultiSelect({
  options,
  selected,
}: {
  options: HistoryShoeOption[];
  selected: string[];
}) {
  const { isPending, setParams } = useUrlParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const setShoes = (ids: string[]) =>
    // The size chips are the selection's own sizes, so a size filter does not
    // survive a change of selection; the other filters do.
    setParams({ shoes: ids.join(",") || null, sizes: null, page: null });

  const toggle = (id: string) =>
    setShoes(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );

  const { groups, hidden } = useMemo(() => {
    // Every token has to match, so "air white" finds "Air Force 1 — White".
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    const matches = options.filter((option) => {
      if (tokens.length === 0) return true;
      const haystack = normalize(`${option.modelName} ${option.color}`);
      return tokens.every((token) => haystack.includes(token));
    });

    const byModel = new Map<string, { modelName: string; colours: HistoryShoeOption[] }>();
    for (const option of matches.slice(0, MAX_VISIBLE)) {
      const group = byModel.get(option.modelId);
      if (group) group.colours.push(option);
      else byModel.set(option.modelId, { modelName: option.modelName, colours: [option] });
    }
    return {
      groups: [...byModel.entries()],
      hidden: Math.max(0, matches.length - MAX_VISIBLE),
    };
  }, [options, query]);

  const selectedOptions = selected.flatMap(
    (id) => options.find((option) => option.shoeId === id) ?? [],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[300px] justify-between"
            >
              {selected.length
                ? `${selected.length} shoe${selected.length > 1 ? "s" : ""} selected`
                : "Pick shoes…"}
              {isPending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] p-0" align="start">
            {/* Filtering is ours, not cmdk's: its fuzzy match scores "air white"
                against one string, where this needs every word to land. */}
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search model or colour…"
                className="h-9"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>No shoes found.</CommandEmpty>
                {groups.map(([modelId, group]) => (
                  <CommandGroup key={modelId} heading={group.modelName}>
                    {group.colours.map((option) => (
                      <CommandItem
                        key={option.shoeId}
                        value={option.shoeId}
                        onSelect={() => toggle(option.shoeId)}
                        className={cn(option.archived && "opacity-50")}
                      >
                        <Checkbox
                          checked={selected.includes(option.shoeId)}
                          className="pointer-events-none mr-2"
                        />
                        <span className="truncate">{option.color}</span>
                        {option.archived && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            archived
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
                {hidden > 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {hidden} more — keep typing to narrow it down.
                  </p>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selected.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => setShoes([])}>
            Clear
          </Button>
        )}
      </div>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <Badge
              key={option.shoeId}
              variant="secondary"
              className={cn("gap-1", option.archived && "opacity-60")}
            >
              {option.modelName} — {option.color}
              <button
                type="button"
                aria-label={`Remove ${option.modelName} ${option.color}`}
                onClick={() => toggle(option.shoeId)}
                className="ml-0.5 rounded-sm hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
