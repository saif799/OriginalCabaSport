"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

type Model = { id: string; name: string };

export function ModelMultiSelect({
  models,
  selected,
}: {
  models: Model[];
  selected: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const setModels = (ids: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length) params.set("models", ids.join(","));
    else params.delete("models");
    startTransition(() =>
      router.push(`/admin/analytics/compare?${params.toString()}`, { scroll: false }),
    );
  };

  const toggle = (id: string) => {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setModels([...set]);
  };

  const selectedModels = models.filter((m) => selected.includes(m.id));

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[260px] justify-between"
          >
            {selected.length
              ? `${selected.length} model${selected.length > 1 ? "s" : ""} selected`
              : "Select models…"}
            {pending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search models…" className="h-9" />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              <CommandGroup>
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.name}
                    onSelect={() => toggle(m.id)}
                  >
                    <Checkbox
                      checked={selected.includes(m.id)}
                      className="pointer-events-none mr-2"
                    />
                    {m.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedModels.map((m) => (
            <Badge key={m.id} variant="secondary" className="gap-1">
              {m.name}
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                onClick={() => toggle(m.id)}
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
