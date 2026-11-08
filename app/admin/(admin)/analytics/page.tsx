import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AdminPage from "@/components/admin/AdminPage";
import { getAnalyticsData, MONTH_NAMES } from "@/lib/analytics";
import { formatDA, formatInt, formatPct } from "@/lib/format";
import { MonthYearSelect } from "./MonthYearSelect";
import {
  HorizontalBars,
  MonthlyOrdersChart,
  MonthlyRevenueChart,
  ProductBars,
  ProviderDonut,
  StatusDonut,
} from "./AnalyticsCharts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { year: yearParam, month: monthParam } = await searchParams;
  const requestedYear = yearParam ? Number(yearParam) : undefined;
  const requestedMonth = monthParam ? Number(monthParam) : undefined;
  const data = await getAnalyticsData(requestedYear, requestedMonth);
  const { kpis, status } = data;
  const periodLabel = `${MONTH_NAMES[data.month - 1]} ${data.year}`;

  return (
    <AdminPage
      title="Analytics"
      description={
        <>
          Figures and charts are for{" "}
          <span className="font-medium text-foreground">{periodLabel}</span>.
        </>
      }
      actions={
        <>
          <Link
            href="/admin/analytics/compare-months"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <GitCompareArrows className="h-4 w-4" />
            Compare months
          </Link>
          <Link
            href="/admin/analytics/compare"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <GitCompareArrows className="h-4 w-4" />
            Compare models
          </Link>
          <MonthYearSelect
            year={data.year}
            month={data.month}
            years={data.years}
            availableMonths={data.availableMonths}
          />
        </>
      }
    >
      {/* KPI tiles — filtered by selected month */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
        <StatTile
          title="Revenue"
          value={formatDA(kpis.revenue)}
          sub="COD collected · delivered"
          wide
        />
        <StatTile title="Delivered" value={formatInt(kpis.deliveredOrders)} sub="orders" />
        <StatTile
          title="Success rate"
          value={formatPct(kpis.successRate)}
          sub={`${formatInt(kpis.returnedOrders)} returned`}
        />
        <StatTile title="Store sales" value={formatInt(kpis.storeSaleUnits)} sub="units" />
        <StatTile title="Units sold" value={formatInt(kpis.unitsSold)} sub="online + store" />
        <StatTile
          title="In stock"
          value={formatInt(kpis.stockUnits)}
          sub={`${formatInt(kpis.outOfStockVariants)}/${formatInt(kpis.totalVariants)} variants out`}
        />
        <StatTile title="Saif payment" value={formatInt(kpis.saifPaymentUnits)} sub="shoes qty · excl. k/m" />
      </section>

      {/* Sales trends */}
      <SectionHeading title="Sales trends" note={`Monthly · ${data.year}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue by month" description="Delivered orders, COD collected">
          <MonthlyRevenueChart data={data.monthly} />
        </ChartCard>
        <ChartCard title="Orders vs store sales" description="Delivered online orders and in-store sales">
          <MonthlyOrdersChart data={data.monthly} />
        </ChartCard>
      </div>

      {/* Delivery & order health */}
      <SectionHeading title="Delivery & order health" note={periodLabel} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Order status breakdown" description={`Orders in ${periodLabel}, by status`}>
          <StatusDonut data={status.breakdown} />
        </ChartCard>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery outcomes</CardTitle>
            <CardDescription>Delivered vs returned, and exchanges</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <StatTile title="Delivered" value={formatInt(status.delivered)} sub="orders" plain />
            <StatTile title="Returned" value={formatInt(status.returned)} sub="orders" plain />
            <StatTile title="Success rate" value={formatPct(status.successRate)} sub="delivered / (del + ret)" plain />
            <StatTile title="Exchanges" value={formatInt(status.exchanges)} sub="échange orders" plain />
          </CardContent>
        </Card>
      </div>

      {/* Channels & geography */}
      <SectionHeading title="Channels & geography" note={periodLabel} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Orders by source" description="Where orders came from">
          <HorizontalBars
            data={data.bySource.map((s) => ({ label: s.label, value: s.orders }))}
            color="var(--chart-2)"
            valueLabel="Orders"
          />
        </ChartCard>
        <ChartCard title="Top wilayas" description="Top 10 by order count">
          <HorizontalBars
            data={data.byWilaya.map((w) => ({ label: w.name, value: w.orders }))}
            color="var(--chart-4)"
            valueLabel="Orders"
          />
        </ChartCard>
        <ChartCard title="Delivery company" description="DHD vs Yalidine, by order count">
          <ProviderDonut data={data.byProvider} />
        </ChartCard>
      </div>

      {/* Products & inventory */}
      <SectionHeading title="Products & inventory" note={`Sold in ${periodLabel} · stock is current`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top models sold" description="Delivered orders + store sales">
          <ProductBars data={data.topModels} color="var(--chart-1)" />
        </ChartCard>
        <ChartCard title="Top colors sold" description="Delivered orders + store sales">
          <ProductBars data={data.topColors} color="var(--chart-3)" />
        </ChartCard>
        <ChartCard title="Current stock by model" description="Units in inventory right now">
          <ProductBars data={data.stockByModel} color="var(--chart-5)" valueLabel="In stock" />
        </ChartCard>
      </div>
    </AdminPage>
  );
}

function StatTile({
  title,
  value,
  sub,
  wide = false,
  plain = false,
}: {
  title: string;
  value: string;
  sub?: string;
  wide?: boolean;
  plain?: boolean;
}) {
  const inner = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </>
  );
  if (plain) return <div>{inner}</div>;
  return (
    <Card className={wide ? "col-span-2 gap-0 py-4" : "gap-0 py-4"}>
      <CardContent className="px-4">{inner}</CardContent>
    </Card>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mt-10 mb-4 flex items-baseline justify-between">
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
