"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DAY = 86_400_000;
const toISODate = (d: Date) => d.toISOString().slice(0, 10);

const PRESETS: { label: string; range: () => [string, string] }[] = [
  {
    label: "30d",
    range: () => [toISODate(new Date(Date.now() - 29 * DAY)), toISODate(new Date())],
  },
  {
    label: "90d",
    range: () => [toISODate(new Date(Date.now() - 89 * DAY)), toISODate(new Date())],
  },
  {
    label: "This year",
    range: () => [`${new Date().getFullYear()}-01-01`, toISODate(new Date())],
  },
  {
    label: "Last year",
    range: () => {
      const y = new Date().getFullYear() - 1;
      return [`${y}-01-01`, `${y}-12-31`];
    },
  },
  { label: "All time", range: () => ["2020-01-01", toISODate(new Date())] },
];

export function RangeControl({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (f: string, t: string) => {
    if (!f || !t) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to", t);
    startTransition(() =>
      router.push(`/admin/analytics/compare?${params.toString()}`, { scroll: false }),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => {
        const [f, t] = p.range();
        const active = f === from && t === to;
        return (
          <Button
            key={p.label}
            size="sm"
            variant={active ? "default" : "outline"}
            onClick={() => apply(f, t)}
          >
            {p.label}
          </Button>
        );
      })}
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(e) => apply(e.target.value, to)}
          className="h-8 w-[150px]"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          value={to}
          min={from}
          onChange={(e) => apply(from, e.target.value)}
          className="h-8 w-[150px]"
        />
      </div>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
