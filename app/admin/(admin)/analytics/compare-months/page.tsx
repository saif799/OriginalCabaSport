import Link from "next/link";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import AdminPage from "@/components/admin/AdminPage";
import {
  getAvailableMonthOptions,
  getMonthComparison,
} from "@/lib/analytics";
import { formatDA, formatInt, formatPct } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MonthMultiSelect } from "./MonthMultiSelect";
import {
  CumulativeUnitsChart,
  DailyRevenueChart,
  DailyUnitsChart,
  OutcomesCompareChart,
  SizeDemandCompareChart,
  SourcesCompareChart,
  TopModelsCompareChart,
} from "./CompareMonthCharts";

export const dynamic = "force-dynamic";

export default async function CompareMonthsPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  const sp = await searchParams;
  const availableMonths = await getAvailableMonthOptions();

  // If no months query param was provided, default to the 2 most recent available months
  let selectedKeys = (sp.months ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (sp.months === undefined && availableMonths.length >= 2) {
    selectedKeys = availableMonths.slice(0, 2).map((m) => m.key);
  } else if (sp.months === undefined && availableMonths.length === 1) {
    selectedKeys = [availableMonths[0].key];
  }

  // Filter to keys that actually exist in available months
  const validKeys = selectedKeys.filter((k) =>
    availableMonths.some((m) => m.key === k),
  );

  const comparison =
    validKeys.length > 0 ? await getMonthComparison(validKeys) : null;

  const palette: Record<string, string> = {};
  comparison?.months.forEach((m) => {
    palette[m.key] = m.color;
  });

  return (
    <AdminPage
      title="Compare months"
      description="Pick two or more months to compare sales velocity, daily trends and product performance side by side."
      actions={
        <div className="flex items-center gap-3">
          <Link
            href="/admin/analytics/compare"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <GitCompareArrows className="h-4 w-4" /> Compare models
          </Link>
          <Link
            href="/admin/analytics"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Analytics
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <MonthMultiSelect
          availableMonths={availableMonths}
          selected={validKeys}
          palette={palette}
        />
      </div>

      {!comparison || comparison.months.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Select at least one month above to see the comparison.
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {/* Totals table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance summary</CardTitle>
              <CardDescription>
                Full-month totals for each selected month. Money is COD collected from
                delivered orders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Units sold</TableHead>
                    <TableHead className="text-right">Delivered orders</TableHead>
                    <TableHead className="text-right">Return rate</TableHead>
                    <TableHead className="text-right">Success rate</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Store sales</TableHead>
                    <TableHead className="text-right">Saif payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.totals.map((t) => {
                    const monthObj = comparison.months.find((m) => m.key === t.key);
                    return (
                      <TableRow key={t.key}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: monthObj?.color }}
                            />
                            {t.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {formatInt(t.unitsSold)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(t.deliveredOrders)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            / {formatInt(t.totalOrders)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPct(t.returnRate)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({formatInt(t.returnedOrders)})
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatPct(t.successRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {formatDA(t.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(t.storeSaleUnits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(t.saifPaymentUnits)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Daily performance trends */}
          <SectionHeading
            title="Daily velocity & trends"
            note="Plotted by day of the month (1st through 31st)"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Daily units sold"
              description="Delivered order items + store sales on each day of the month"
            >
              <DailyUnitsChart
                data={comparison.dailyUnits}
                months={comparison.months}
              />
            </ChartCard>
            <ChartCard
              title="Daily revenue"
              description="COD collected on delivered orders by day of the month"
            >
              <DailyRevenueChart
                data={comparison.dailyRevenue}
                months={comparison.months}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4">
            <ChartCard
              title="Cumulative units sold"
              description="Running total of units sold as each month progresses"
            >
              <CumulativeUnitsChart
                data={comparison.cumulativeUnits}
                months={comparison.months}
              />
            </ChartCard>
          </div>

          {/* Product demand */}
          <SectionHeading
            title="Product & size demand"
            note="Delivered orders + store sales"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Top models sold"
              description="Units sold per model across the compared months"
            >
              <TopModelsCompareChart
                data={comparison.topModels}
                months={comparison.months}
              />
            </ChartCard>
            <ChartCard
              title="Size demand"
              description="Units sold per shoe size in each month"
            >
              <SizeDemandCompareChart
                data={comparison.sizeDemand}
                months={comparison.months}
              />
            </ChartCard>
          </div>

          {/* Channels & Outcomes */}
          <SectionHeading
            title="Channels & delivery health"
            note="Order acquisition and delivery outcomes"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Orders by source"
              description="Where orders were placed (Instagram, Facebook, etc.)"
            >
              <SourcesCompareChart
                data={comparison.bySource}
                months={comparison.months}
              />
            </ChartCard>
            <ChartCard
              title="Delivery outcomes & order volume"
              description="Volume comparison across key operational metrics"
            >
              <OutcomesCompareChart
                data={comparison.deliveryOutcomes}
                months={comparison.months}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </AdminPage>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mt-8 mb-3 flex items-baseline justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
