"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ComparedMonth, WideRow } from "@/lib/analytics";
import { formatCompact, formatDA } from "@/lib/format";

function buildConfig(months: ComparedMonth[]): ChartConfig {
  const config: ChartConfig = {};
  months.forEach((m) => {
    config[m.key] = { label: m.label, color: m.color };
  });
  return config;
}

export function DailyUnitsChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No sales data in this period." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[320px] w-full">
      <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Line
            key={m.key}
            type="monotone"
            dataKey={m.key}
            stroke={m.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export function DailyRevenueChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No revenue data in this period." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[320px] w-full">
      <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(val) => formatCompact(Number(val))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatDA(Number(value))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Line
            key={m.key}
            type="monotone"
            dataKey={m.key}
            stroke={m.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export function CumulativeUnitsChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No sales data in this period." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[320px] w-full">
      <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Line
            key={m.key}
            type="monotone"
            dataKey={m.key}
            stroke={m.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export function TopModelsCompareChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No model sales data for these months." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[320px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="key"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={60}
        />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Bar key={m.key} dataKey={m.key} fill={m.color} radius={3} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export function SizeDemandCompareChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No size data for these months." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[300px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Bar key={m.key} dataKey={m.key} fill={m.color} radius={3} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export function SourcesCompareChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No source data for these months." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[300px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Bar key={m.key} dataKey={m.key} fill={m.color} radius={3} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export function OutcomesCompareChart({
  data,
  months,
}: {
  data: WideRow[];
  months: ComparedMonth[];
}) {
  if (data.length === 0) return <Empty text="No outcome data for these months." />;
  return (
    <ChartContainer config={buildConfig(months)} className="aspect-auto h-[300px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {months.map((m) => (
          <Bar key={m.key} dataKey={m.key} fill={m.color} radius={3} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
