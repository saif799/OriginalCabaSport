"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronsUpDown, Loader2, X } from "lucide-react";
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
import type { MonthOption } from "@/lib/analytics";

export function MonthMultiSelect({
  availableMonths,
  selected,
  palette,
}: {
  availableMonths: MonthOption[];
  selected: string[];
  palette?: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const setMonths = (keys: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (keys.length) params.set("months", keys.join(","));
    else params.delete("months");
    startTransition(() =>
      router.push(`/admin/analytics/compare-months?${params.toString()}`, {
        scroll: false,
      }),
    );
  };

  const toggle = (key: string) => {
    const set = new Set(selected);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    setMonths([...set]);
  };

  const selectPreset = (type: "last2" | "last3" | "last6" | "thisYear") => {
    if (type === "last2") {
      setMonths(availableMonths.slice(0, 2).map((m) => m.key));
    } else if (type === "last3") {
      setMonths(availableMonths.slice(0, 3).map((m) => m.key));
    } else if (type === "last6") {
      setMonths(availableMonths.slice(0, 6).map((m) => m.key));
    } else if (type === "thisYear") {
      const currentYear = availableMonths[0]?.year ?? new Date().getFullYear();
      const thisYearMonths = availableMonths
        .filter((m) => m.year === currentYear)
        .map((m) => m.key);
      setMonths(thisYearMonths);
    }
  };

  const selectedOptions = availableMonths.filter((m) => selected.includes(m.key));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[260px] justify-between"
            >
              <span className="flex items-center gap-2 truncate">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {selected.length
                  ? `${selected.length} month${selected.length > 1 ? "s" : ""} selected`
                  : "Select months…"}
              </span>
              {pending ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search months…" className="h-9" />
              <CommandList>
                <CommandEmpty>No month found.</CommandEmpty>
                <CommandGroup>
                  {availableMonths.map((m) => {
                    const isChecked = selected.includes(m.key);
                    const color = palette?.[m.key];
                    return (
                      <CommandItem
                        key={m.key}
                        value={`${m.label} ${m.key}`}
                        onSelect={() => toggle(m.key)}
                      >
                        <Checkbox
                          checked={isChecked}
                          className="pointer-events-none mr-2"
                        />
                        {color && (
                          <span
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        )}
                        <span>{m.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Preset quick buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => selectPreset("last2")}
          >
            Last 2m
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => selectPreset("last3")}
          >
            Last 3m
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => selectPreset("last6")}
          >
            Last 6m
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => selectPreset("thisYear")}
          >
            This year
          </Button>
          {selected.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setMonths([])}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((m) => {
            const color = palette?.[m.key];
            return (
              <Badge key={m.key} variant="secondary" className="gap-1.5 py-1">
                {color && (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                )}
                <span>{m.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${m.label}`}
                  onClick={() => toggle(m.key)}
                  className="ml-0.5 rounded-sm hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
