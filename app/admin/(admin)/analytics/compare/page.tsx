import Link from "next/link";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { shoeModels } from "@/lib/schema";
import AdminPage from "@/components/admin/AdminPage";
import { getModelComparison } from "@/lib/analytics";
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
import { ModelMultiSelect } from "./ModelMultiSelect";
import { RangeControl } from "./RangeControl";
import { SizeDemandChart, UnitsTrendChart } from "./CompareCharts";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const toISODate = (d: Date) => d.toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | undefined, fallback: string): string {
  if (value && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  return fallback;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ models?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  const defaultTo = toISODate(new Date());
  const defaultFrom = toISODate(new Date(Date.now() - 89 * DAY));
  let from = parseDate(sp.from, defaultFrom);
  let to = parseDate(sp.to, defaultTo);
  if (from > to) [from, to] = [to, from];

  const modelIds = (sp.models ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const allModels = await db
    .select({ id: shoeModels.id, name: shoeModels.modelName })
    .from(shoeModels)
    .orderBy(asc(shoeModels.modelName));

  const validIds = modelIds.filter((id) => allModels.some((m) => m.id === id));

  const comparison =
    validIds.length > 0
      ? await getModelComparison({
          modelIds: validIds,
          from: new Date(`${from}T00:00:00.000Z`),
          to: new Date(`${to}T00:00:00.000Z`),
        })
      : null;

  return (
    <AdminPage
      title="Compare models"
      description="Pick two or more models to compare their sales, returns and size demand over a period."
      actions={
        <div className="flex items-center gap-3">
          <Link
            href="/admin/analytics/compare-months"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <GitCompareArrows className="h-4 w-4" /> Compare months
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <ModelMultiSelect models={allModels} selected={validIds} />
        <RangeControl from={from} to={to} />
      </div>

      {!comparison || comparison.models.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Select at least one model above to see the comparison.
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {/* Totals table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
              <CardDescription>
                For {from} → {to}. Revenue is approximate (order amount split across its
                items). Stock is current.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Units sold</TableHead>
                    <TableHead className="text-right">Delivered orders</TableHead>
                    <TableHead className="text-right">Return rate</TableHead>
                    <TableHead className="text-right">≈ Revenue</TableHead>
                    <TableHead className="text-right">In stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.totals.map((t) => {
                    const model = comparison.models.find((m) => m.id === t.modelId);
                    return (
                      <TableRow key={t.modelId}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: model?.color }}
                            />
                            {t.modelName}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(t.unitsSold)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(t.deliveredOrders)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPct(t.returnRate)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({formatInt(t.returnedUnits)})
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDA(t.revenueApprox)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInt(t.currentStock)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Units sold over time */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Units sold over time</CardTitle>
              <CardDescription>
                Delivered orders + store sales, bucketed by {comparison.bucketUnit}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UnitsTrendChart data={comparison.timeSeries} models={comparison.models} />
            </CardContent>
          </Card>

          {/* Size demand */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Size demand</CardTitle>
              <CardDescription>Units sold per size in the period.</CardDescription>
            </CardHeader>
            <CardContent>
              <SizeDemandChart data={comparison.sizeDemand} models={comparison.models} />
            </CardContent>
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
