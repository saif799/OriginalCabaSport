"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTH_NAMES } from "@/lib/analytics";

export function MonthYearSelect({
  year,
  month,
  years,
  availableMonths,
}: {
  year: number;
  month: number;
  years: number[];
  availableMonths: number[];
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <Select
        value={String(month)}
        onValueChange={(v) =>
          router.push(`/admin/analytics?year=${year}&month=${v}`, {
            scroll: false,
          })
        }
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableMonths.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {MONTH_NAMES[m - 1]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(year)}
        onValueChange={(v) =>
          router.push(`/admin/analytics?year=${v}`, { scroll: false })
        }
      >
        <SelectTrigger className="w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
