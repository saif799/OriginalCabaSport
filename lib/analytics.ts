/**
 * Analytics aggregates for the /analytics page. Every function is a read-only
 * Drizzle query. Revenue = SUM(montant) of DELIVERED orders only (there is no
 * product price stored anywhere, and store sales carry no amount — so store
 * sales are counted as units). Money is "COD collected".
 */
import { db } from "@/lib/db";
import {
  orderItems,
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
  storeSales,
} from "@/lib/schema";
import { sql } from "drizzle-orm";
import wilayas from "@/wilayas.json";
import { CHART_PALETTE } from "@/lib/format";
import {
  DELIVERED_STATUS_ID,
  RETURNED_STATUS_ID,
  CANCELED_STATUS_ID,
} from "@/lib/orders/status";

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// Order `source` code -> label (mirrors AvailableSources in sendShoeOrder.tsx).
const SOURCE_LABELS: Record<string, string> = {
  i: "Instagram",
  f: "Facebook",
  t: "TikTok",
  w: "WhatsApp",
  k: "Ignore",
  m: "Mossab",
};

const WILAYA_NAMES: Record<string, string> = Object.fromEntries(
  (wilayas as { wilaya_id: number; wilaya_name: string }[]).map((w) => [
    String(w.wilaya_id),
    w.wilaya_name,
  ]),
);

const n = (v: unknown) => Number(v ?? 0);

// Reusable SQL fragment: numeric value of the (varchar) montant column.
const MONTANT = sql`CAST(NULLIF(${ordersTable.montant}, '') AS NUMERIC)`;

export type Kpis = {
  revenue: number;
  deliveredOrders: number;
  totalOrders: number;
  returnedOrders: number;
  successRate: number; // 0..1
  storeSaleUnits: number;
  unitsSold: number;
  stockUnits: number;
  outOfStockVariants: number;
  totalVariants: number;
  saifPaymentUnits: number;
};

export type MonthlyRow = {
  month: string;
  orders: number;
  revenue: number;
  storeSales: number;
};

export type NamedCount = { name: string; count: number };
export type SourceRow = { label: string; orders: number; revenue: number };
export type WilayaRow = { name: string; orders: number; revenue: number };
export type ProviderRow = { name: string; orders: number };
export type ProductRow = { label: string; units: number };

export type AnalyticsData = {
  year: number;
  month: number;
  years: number[];
  availableMonths: number[];
  kpis: Kpis;
  monthly: MonthlyRow[];
  status: {
    breakdown: NamedCount[];
    delivered: number;
    returned: number;
    exchanges: number;
    total: number;
    successRate: number;
  };
  bySource: SourceRow[];
  byWilaya: WilayaRow[];
  byProvider: ProviderRow[];
  topModels: ProductRow[];
  topColors: ProductRow[];
  stockByModel: ProductRow[];
};

async function getAvailableYears(): Promise<number[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT EXTRACT(YEAR FROM ${ordersTable.createdAt})::int AS y
    FROM ${ordersTable}
    ORDER BY y DESC
  `);
  const years = res.rows.map((r) => n((r as { y: unknown }).y));
  return years.length ? years : [new Date().getFullYear()];
}

async function getAvailableMonths(year: number): Promise<number[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT EXTRACT(MONTH FROM ${ordersTable.createdAt})::int AS m
    FROM ${ordersTable}
    WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
    ORDER BY m DESC
  `);
  const months = res.rows.map((r) => n((r as { m: unknown }).m));
  return months.length ? months : [new Date().getMonth() + 1];
}

async function getKpis(year: number, month: number): Promise<Kpis> {
  const [orders, deliveredUnits, stock, storeUnits, saifPayment] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID})::int AS delivered,
        COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${RETURNED_STATUS_ID})::int AS returned,
        COALESCE(SUM(${MONTANT}) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}), 0)::float8 AS revenue
      FROM ${ordersTable}
      WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(${orderItems.quantity}), 0)::int AS units
      FROM ${orderItems}
      JOIN ${ordersTable} ON ${ordersTable.id} = ${orderItems.orderId}
      WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}
        AND EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    `),
    db.execute(sql`
      SELECT
        COALESCE(SUM(${shoeInventory.quantity}), 0)::int AS stock_units,
        COUNT(*)::int AS total_variants,
        COUNT(*) FILTER (WHERE ${shoeInventory.quantity} = 0)::int AS out_of_stock
      FROM ${shoeInventory}
    `),
    db.execute(sql`SELECT COUNT(*)::int AS units FROM ${storeSales} WHERE EXTRACT(YEAR FROM ${storeSales.createdAt}) = ${year} AND EXTRACT(MONTH FROM ${storeSales.createdAt}) = ${month}`),
    // Saif Payment: total shoe quantity from orders, excluding source k/m and store sales
    db.execute(sql`
      SELECT COALESCE(SUM(${orderItems.quantity}), 0)::int AS units
      FROM ${orderItems}
      JOIN ${ordersTable} ON ${ordersTable.id} = ${orderItems.orderId}
      WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}
        AND ${ordersTable.source} NOT IN ('k', 'm')
        AND EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    `),
  ]);

  const o = orders.rows[0] as Record<string, unknown>;
  const delivered = n(o.delivered);
  const returned = n(o.returned);
  const storeSaleUnits = n((storeUnits.rows[0] as { units: unknown }).units);
  const deliveredUnitCount = n((deliveredUnits.rows[0] as { units: unknown }).units);
  const s = stock.rows[0] as Record<string, unknown>;
  const saifPaymentUnits = n((saifPayment.rows[0] as { units: unknown }).units);

  return {
    revenue: n(o.revenue),
    deliveredOrders: delivered,
    totalOrders: n(o.total_orders),
    returnedOrders: returned,
    successRate: delivered + returned > 0 ? delivered / (delivered + returned) : 0,
    storeSaleUnits,
    unitsSold: deliveredUnitCount + storeSaleUnits,
    stockUnits: n(s.stock_units),
    outOfStockVariants: n(s.out_of_stock),
    totalVariants: n(s.total_variants),
    saifPaymentUnits,
  };
}

async function getMonthlyTrends(year: number): Promise<MonthlyRow[]> {
  const res = await db.execute(sql`
    WITH months AS (SELECT gs AS m FROM generate_series(1, 12) gs),
    o AS (
      SELECT EXTRACT(MONTH FROM ${ordersTable.createdAt})::int AS m,
             COUNT(*)::int AS orders,
             COALESCE(SUM(${MONTANT}), 0)::float8 AS revenue
      FROM ${ordersTable}
      WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}
        AND EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
      GROUP BY 1
    ),
    s AS (
      SELECT EXTRACT(MONTH FROM ${storeSales.createdAt})::int AS m, COUNT(*)::int AS store_sales
      FROM ${storeSales}
      WHERE EXTRACT(YEAR FROM ${storeSales.createdAt}) = ${year}
      GROUP BY 1
    )
    SELECT months.m AS m,
           COALESCE(o.orders, 0)::int AS orders,
           COALESCE(o.revenue, 0)::float8 AS revenue,
           COALESCE(s.store_sales, 0)::int AS store_sales
    FROM months
    LEFT JOIN o ON o.m = months.m
    LEFT JOIN s ON s.m = months.m
    ORDER BY months.m
  `);

  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      month: MONTHS[n(row.m) - 1] ?? String(row.m),
      orders: n(row.orders),
      revenue: n(row.revenue),
      storeSales: n(row.store_sales),
    };
  });
}

async function getStatusBreakdown(year: number, month: number) {
  const [breakdown, totals] = await Promise.all([
    db.execute(sql`
      SELECT ${stautsGroupsTable.name} AS name, COUNT(${ordersTable.id})::int AS count
      FROM ${ordersTable}
      JOIN ${stautsGroupsTable} ON ${stautsGroupsTable.id} = ${ordersTable.statusId}
      WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
      GROUP BY ${stautsGroupsTable.name}
      ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID})::int AS delivered,
        COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${RETURNED_STATUS_ID})::int AS returned,
        COUNT(*) FILTER (WHERE ${ordersTable.type} = 2)::int AS exchanges
      FROM ${ordersTable}
      WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    `),
  ]);

  const t = totals.rows[0] as Record<string, unknown>;
  const delivered = n(t.delivered);
  const returned = n(t.returned);

  return {
    breakdown: breakdown.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return { name: String(row.name), count: n(row.count) };
    }),
    delivered,
    returned,
    exchanges: n(t.exchanges),
    total: n(t.total),
    successRate: delivered + returned > 0 ? delivered / (delivered + returned) : 0,
  };
}

async function getBySource(year: number, month: number): Promise<SourceRow[]> {
  const res = await db.execute(sql`
    SELECT ${ordersTable.source} AS source,
           COUNT(*)::int AS orders,
           COALESCE(SUM(${MONTANT}) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}), 0)::float8 AS revenue
    FROM ${ordersTable}
    WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
      AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    GROUP BY ${ordersTable.source}
    ORDER BY orders DESC
  `);
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const code = String(row.source ?? "");
    return {
      label: SOURCE_LABELS[code] ?? (code || "Unknown"),
      orders: n(row.orders),
      revenue: n(row.revenue),
    };
  });
}

async function getByWilaya(year: number, month: number): Promise<WilayaRow[]> {
  const res = await db.execute(sql`
    SELECT ${ordersTable.code_wilaya} AS code,
           COUNT(*)::int AS orders,
           COALESCE(SUM(${MONTANT}) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}), 0)::float8 AS revenue
    FROM ${ordersTable}
    WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
      AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    GROUP BY ${ordersTable.code_wilaya}
    ORDER BY orders DESC
    LIMIT 10
  `);
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const code = String(row.code ?? "");
    return {
      name: WILAYA_NAMES[code] ? `${code} · ${WILAYA_NAMES[code]}` : code || "?",
      orders: n(row.orders),
      revenue: n(row.revenue),
    };
  });
}

async function getByProvider(year: number, month: number): Promise<ProviderRow[]> {
  const res = await db.execute(sql`
    SELECT ${ordersTable.provider} AS provider, COUNT(*)::int AS orders
    FROM ${ordersTable}
    WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
      AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
    GROUP BY ${ordersTable.provider}
    ORDER BY orders DESC
  `);
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const p = String(row.provider ?? "dhd");
    return { name: p === "yalidine" ? "Yalidine" : "DHD", orders: n(row.orders) };
  });
}

/** Units sold (delivered order items + store sales) grouped by a product column. */
async function getTopSold(
  year: number,
  month: number,
  by: "model" | "color",
): Promise<ProductRow[]> {
  const groupCol = by === "model" ? shoeModels.modelName : shoes.color;
  const res = await db.execute(sql`
    WITH sold AS (
      SELECT ${orderItems.shoeInventoryId} AS inv_id, ${orderItems.quantity}::int AS qty
      FROM ${orderItems}
      JOIN ${ordersTable} ON ${ordersTable.id} = ${orderItems.orderId}
      WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}
        AND EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${month}
      UNION ALL
      SELECT ${storeSales.shoeInventoryId} AS inv_id, 1 AS qty
      FROM ${storeSales}
      WHERE EXTRACT(YEAR FROM ${storeSales.createdAt}) = ${year}
        AND EXTRACT(MONTH FROM ${storeSales.createdAt}) = ${month}
    )
    SELECT ${groupCol} AS label, SUM(sold.qty)::int AS units
    FROM sold
    JOIN ${shoeInventory} ON ${shoeInventory.id} = sold.inv_id
    JOIN ${shoes} ON ${shoes.id} = ${shoeInventory.shoeId}
    JOIN ${shoeModels} ON ${shoeModels.id} = ${shoes.modelId}
    GROUP BY ${groupCol}
    ORDER BY units DESC
    LIMIT 10
  `);
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return { label: String(row.label ?? "?"), units: n(row.units) };
  });
}

async function getStockByModel(): Promise<ProductRow[]> {
  const res = await db.execute(sql`
    SELECT ${shoeModels.modelName} AS label, SUM(${shoeInventory.quantity})::int AS units
    FROM ${shoeInventory}
    JOIN ${shoes} ON ${shoes.id} = ${shoeInventory.shoeId}
    JOIN ${shoeModels} ON ${shoeModels.id} = ${shoes.modelId}
    GROUP BY ${shoeModels.modelName}
    ORDER BY units DESC
    LIMIT 10
  `);
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return { label: String(row.label ?? "?"), units: n(row.units) };
  });
}

/** Loads everything the /analytics page needs for the given year. */
export async function getAnalyticsData(requestedYear?: number, requestedMonth?: number): Promise<AnalyticsData> {
  const years = await getAvailableYears();
  const year =
    requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  const availableMonths = await getAvailableMonths(year);
  const month =
    requestedMonth && availableMonths.includes(requestedMonth) ? requestedMonth : availableMonths[0];

  const [kpis, monthly, status, bySource, byWilaya, byProvider, topModels, topColors, stockByModel] =
    await Promise.all([
      getKpis(year, month),
      getMonthlyTrends(year),
      getStatusBreakdown(year, month),
      getBySource(year, month),
      getByWilaya(year, month),
      getByProvider(year, month),
      getTopSold(year, month, "model"),
      getTopSold(year, month, "color"),
      getStockByModel(),
    ]);

  return {
    year,
    month,
    years,
    availableMonths,
    kpis,
    monthly,
    status,
    bySource,
    byWilaya,
    byProvider,
    topModels,
    topColors,
    stockByModel,
  };
}

// ---------------------------------------------------------------------------
// Model comparison (/analytics/compare)
// ---------------------------------------------------------------------------

export type BucketUnit = "day" | "week" | "month";

export type ComparedModel = { id: string; name: string; color: string };

export type ModelTotals = {
  modelId: string;
  modelName: string;
  unitsSold: number; // delivered order items + store sales in range
  deliveredOrders: number;
  returnedUnits: number;
  returnRate: number; // 0..1 (returned / (delivered units + returned units))
  revenueApprox: number; // montant split proportionally across an order's items
  currentStock: number; // snapshot, not range-bound
};

// Wide rows for the charts: { bucket|size, [modelId]: units, ... }
export type WideRow = { key: string } & Record<string, number | string>;

export type ModelComparison = {
  models: ComparedModel[];
  bucketUnit: BucketUnit;
  timeSeries: WideRow[]; // key = bucket label
  sizeDemand: WideRow[]; // key = size
  totals: ModelTotals[];
};

function pickBucketUnit(from: Date, to: Date): BucketUnit {
  const days = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);
  if (days <= 45) return "day";
  if (days <= 210) return "week";
  return "month";
}

function bucketLabel(iso: string, unit: BucketUnit): string {
  const d = new Date(iso);
  if (unit === "month") {
    return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

/**
 * Compares the given models over [from, to]. `to` is treated as inclusive of the
 * whole day. Returns chart-ready wide rows plus a per-model totals table.
 */
export async function getModelComparison(params: {
  modelIds: string[];
  from: Date;
  to: Date;
}): Promise<ModelComparison> {
  const modelIds = Array.from(new Set(params.modelIds));
  const unit = pickBucketUnit(params.from, params.to);

  if (modelIds.length === 0) {
    return { models: [], bucketUnit: unit, timeSeries: [], sizeDemand: [], totals: [] };
  }

  const fromISO = params.from.toISOString();
  // Make `to` inclusive of its whole day.
  const toExclusive = new Date(params.to.getTime() + 86_400_000).toISOString();
  const idList = sql.join(
    modelIds.map((id) => sql`${id}`),
    sql`, `,
  );

  // Units sold in range = delivered order items + store sales, tagged with size.
  const soldUnion = sql`(
    SELECT o.created_at::timestamptz AS dt, si.size AS size, m.id AS model_id, oi.quantity::int AS qty
    FROM ${ordersTable} o
    JOIN ${orderItems} oi ON oi.order_id = o.id
    JOIN ${shoeInventory} si ON si.id = oi.shoe_inventory_id
    JOIN ${shoes} sh ON sh.id = si.shoe_id
    JOIN ${shoeModels} m ON m.id = sh.model_id
    WHERE o.status_id = ${DELIVERED_STATUS_ID}
      AND o.created_at >= ${fromISO} AND o.created_at < ${toExclusive}
      AND m.id::text IN (${idList})
    UNION ALL
    SELECT ss.created_at::timestamptz AS dt, si.size AS size, m.id AS model_id, 1 AS qty
    FROM ${storeSales} ss
    JOIN ${shoeInventory} si ON si.id = ss.shoe_inventory_id
    JOIN ${shoes} sh ON sh.id = si.shoe_id
    JOIN ${shoeModels} m ON m.id = sh.model_id
    WHERE ss.created_at >= ${fromISO} AND ss.created_at < ${toExclusive}
      AND m.id::text IN (${idList})
  ) AS sold`;

  const [tsRes, sizeRes, orderStatsRes, revenueRes, stockRes, nameRes] =
    await Promise.all([
      db.execute(sql`
        SELECT date_trunc(${unit}, sold.dt) AS bucket, sold.model_id AS model_id, SUM(sold.qty)::int AS units
        FROM ${soldUnion}
        GROUP BY 1, 2
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT sold.size AS size, sold.model_id AS model_id, SUM(sold.qty)::int AS units
        FROM ${soldUnion}
        GROUP BY 1, 2
      `),
      db.execute(sql`
        SELECT m.id AS model_id,
          COUNT(oi.id) FILTER (WHERE o.status_id = ${DELIVERED_STATUS_ID})::int AS delivered_units,
          COUNT(DISTINCT o.id) FILTER (WHERE o.status_id = ${DELIVERED_STATUS_ID})::int AS delivered_orders,
          COUNT(oi.id) FILTER (WHERE o.status_id = ${RETURNED_STATUS_ID})::int AS returned_units
        FROM ${ordersTable} o
        JOIN ${orderItems} oi ON oi.order_id = o.id
        JOIN ${shoeInventory} si ON si.id = oi.shoe_inventory_id
        JOIN ${shoes} sh ON sh.id = si.shoe_id
        JOIN ${shoeModels} m ON m.id = sh.model_id
        WHERE o.status_id IN (${DELIVERED_STATUS_ID}, ${RETURNED_STATUS_ID})
          AND o.created_at >= ${fromISO} AND o.created_at < ${toExclusive}
          AND m.id::text IN (${idList})
        GROUP BY m.id
      `),
      db.execute(sql`
        WITH ot AS (
          SELECT order_id, COUNT(*)::numeric AS total_items FROM ${orderItems} GROUP BY order_id
        ),
        mi AS (
          SELECT oi.order_id AS order_id, m.id AS model_id, COUNT(*)::numeric AS model_items
          FROM ${orderItems} oi
          JOIN ${shoeInventory} si ON si.id = oi.shoe_inventory_id
          JOIN ${shoes} sh ON sh.id = si.shoe_id
          JOIN ${shoeModels} m ON m.id = sh.model_id
          WHERE m.id::text IN (${idList})
          GROUP BY oi.order_id, m.id
        )
        SELECT mi.model_id AS model_id,
          COALESCE(SUM(CAST(NULLIF(o.montant, '') AS NUMERIC) * mi.model_items / ot.total_items), 0)::float8 AS revenue
        FROM mi
        JOIN ot ON ot.order_id = mi.order_id
        JOIN ${ordersTable} o ON o.id = mi.order_id
        WHERE o.status_id = ${DELIVERED_STATUS_ID}
          AND o.created_at >= ${fromISO} AND o.created_at < ${toExclusive}
        GROUP BY mi.model_id
      `),
      db.execute(sql`
        SELECT m.id AS model_id, COALESCE(SUM(si.quantity), 0)::int AS stock
        FROM ${shoeInventory} si
        JOIN ${shoes} sh ON sh.id = si.shoe_id
        JOIN ${shoeModels} m ON m.id = sh.model_id
        WHERE m.id::text IN (${idList})
        GROUP BY m.id
      `),
      db.execute(sql`
        SELECT id AS model_id, model_name FROM ${shoeModels} WHERE id::text IN (${idList})
      `),
    ]);

  const nameById = new Map<string, string>();
  for (const r of nameRes.rows) {
    const row = r as Record<string, unknown>;
    nameById.set(String(row.model_id), String(row.model_name));
  }

  // Preserve the caller's model order; assign a stable palette color per model.
  const models: ComparedModel[] = modelIds.map((id, i) => ({
    id,
    name: nameById.get(id) ?? "Unknown model",
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }));

  // --- time series (pivot long -> wide, fill missing model -> 0) ---
  const bucketOrder: string[] = [];
  const seenBucket = new Set<string>();
  const unitsByBucket = new Map<string, Record<string, number>>();
  const unitsTotal = new Map<string, number>();
  for (const r of tsRes.rows) {
    const row = r as Record<string, unknown>;
    const bucket = String(row.bucket);
    const modelId = String(row.model_id);
    const units = n(row.units);
    if (!seenBucket.has(bucket)) {
      seenBucket.add(bucket);
      bucketOrder.push(bucket);
    }
    const bucketRow = unitsByBucket.get(bucket) ?? {};
    bucketRow[modelId] = units;
    unitsByBucket.set(bucket, bucketRow);
    unitsTotal.set(modelId, (unitsTotal.get(modelId) ?? 0) + units);
  }
  const timeSeries: WideRow[] = bucketOrder.map((b) => {
    const row: WideRow = { key: bucketLabel(b, unit) };
    for (const m of models) row[m.id] = unitsByBucket.get(b)?.[m.id] ?? 0;
    return row;
  });

  // --- size demand (pivot long -> wide, sizes sorted numerically) ---
  const sizeByModel = new Map<string, Record<string, number>>();
  for (const r of sizeRes.rows) {
    const row = r as Record<string, unknown>;
    const size = String(row.size);
    const rec = sizeByModel.get(size) ?? {};
    rec[String(row.model_id)] = n(row.units);
    sizeByModel.set(size, rec);
  }
  const sizeDemand: WideRow[] = Array.from(sizeByModel.keys())
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((size) => {
      const row: WideRow = { key: size };
      for (const m of models) row[m.id] = sizeByModel.get(size)?.[m.id] ?? 0;
      return row;
    });

  // --- totals ---
  const statsById = new Map<string, Record<string, unknown>>();
  for (const r of orderStatsRes.rows) {
    const row = r as Record<string, unknown>;
    statsById.set(String(row.model_id), row);
  }
  const revenueById = new Map<string, number>();
  for (const r of revenueRes.rows) {
    const row = r as Record<string, unknown>;
    revenueById.set(String(row.model_id), n(row.revenue));
  }
  const stockById = new Map<string, number>();
  for (const r of stockRes.rows) {
    const row = r as Record<string, unknown>;
    stockById.set(String(row.model_id), n(row.stock));
  }

  const totals: ModelTotals[] = models.map((m) => {
    const s = statsById.get(m.id) ?? {};
    const deliveredUnits = n(s.delivered_units);
    const returnedUnits = n(s.returned_units);
    return {
      modelId: m.id,
      modelName: m.name,
      unitsSold: unitsTotal.get(m.id) ?? 0,
      deliveredOrders: n(s.delivered_orders),
      returnedUnits,
      returnRate:
        deliveredUnits + returnedUnits > 0
          ? returnedUnits / (deliveredUnits + returnedUnits)
          : 0,
      revenueApprox: revenueById.get(m.id) ?? 0,
      currentStock: stockById.get(m.id) ?? 0,
    };
  });

  return { models, bucketUnit: unit, timeSeries, sizeDemand, totals };
}

// ---------------------------------------------------------------------------
// Month comparison (/analytics/compare-months)
// ---------------------------------------------------------------------------

export type MonthOption = {
  key: string; // "YYYY-MM"
  year: number;
  month: number;
  label: string; // "November 2026"
  shortLabel: string; // "Nov 2026"
};

export async function getAvailableMonthOptions(): Promise<MonthOption[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT
      EXTRACT(YEAR FROM d)::int AS y,
      EXTRACT(MONTH FROM d)::int AS m
    FROM (
      SELECT ${ordersTable.createdAt} AS d FROM ${ordersTable}
      UNION ALL
      SELECT ${storeSales.createdAt} AS d FROM ${storeSales}
    ) dates
    WHERE d IS NOT NULL
    ORDER BY y DESC, m DESC
  `);
  const list: MonthOption[] = [];
  for (const r of res.rows) {
    const row = r as Record<string, unknown>;
    const y = n(row.y);
    const m = n(row.m);
    if (y && m && m >= 1 && m <= 12) {
      list.push({
        key: `${y}-${String(m).padStart(2, "0")}`,
        year: y,
        month: m,
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        shortLabel: `${MONTHS[m - 1]} ${y}`,
      });
    }
  }
  if (!list.length) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    list.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      year: y,
      month: m,
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      shortLabel: `${MONTHS[m - 1]} ${y}`,
    });
  }
  return list;
}

export type ComparedMonth = {
  key: string;
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  color: string;
};

export type MonthTotals = {
  key: string;
  year: number;
  month: number;
  label: string;
  unitsSold: number;
  deliveredOrders: number;
  totalOrders: number;
  returnedOrders: number;
  returnedUnits: number;
  returnRate: number;
  successRate: number;
  revenue: number;
  storeSaleUnits: number;
  saifPaymentUnits: number;
};

export type MonthComparison = {
  months: ComparedMonth[];
  totals: MonthTotals[];
  dailyUnits: WideRow[];
  dailyRevenue: WideRow[];
  cumulativeUnits: WideRow[];
  cumulativeRevenue: WideRow[];
  topModels: WideRow[];
  topColors: WideRow[];
  sizeDemand: WideRow[];
  bySource: WideRow[];
  deliveryOutcomes: WideRow[];
};

export async function getMonthComparison(monthKeys: string[]): Promise<MonthComparison> {
  const parsedMap = new Map<string, { year: number; month: number }>();
  for (const k of monthKeys) {
    const parts = k.trim().split("-");
    if (parts.length === 2) {
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      if (y > 2000 && m >= 1 && m <= 12) {
        parsedMap.set(`${y}-${String(m).padStart(2, "0")}`, { year: y, month: m });
      }
    }
  }

  const sortedKeys = Array.from(parsedMap.entries()).sort(
    (a, b) => a[1].year - b[1].year || a[1].month - b[1].month,
  );

  const months: ComparedMonth[] = sortedKeys.map(([key, val], idx) => ({
    key,
    year: val.year,
    month: val.month,
    label: `${MONTH_NAMES[val.month - 1]} ${val.year}`,
    shortLabel: `${MONTHS[val.month - 1]} ${String(val.year).slice(2)}`,
    color: CHART_PALETTE[idx % CHART_PALETTE.length],
  }));

  if (months.length === 0) {
    return {
      months: [],
      totals: [],
      dailyUnits: [],
      dailyRevenue: [],
      cumulativeUnits: [],
      cumulativeRevenue: [],
      topModels: [],
      topColors: [],
      sizeDemand: [],
      bySource: [],
      deliveryOutcomes: [],
    };
  }

  const monthData = await Promise.all(
    months.map(async (m) => {
      const [
        ordersRes,
        orderUnitsRes,
        storeSalesRes,
        saifPaymentRes,
        dailyOrdersRes,
        dailyUnitsRes,
        modelsRes,
        colorsRes,
        sizesRes,
        sourcesRes,
      ] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID})::int AS delivered,
            COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${RETURNED_STATUS_ID})::int AS returned,
            COALESCE(SUM(${MONTANT}) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}), 0)::float8 AS revenue
          FROM ${ordersTable}
          WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${m.year}
            AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${m.month}
        `),
        db.execute(sql`
          SELECT
            COALESCE(SUM(${orderItems.quantity}) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}), 0)::int AS delivered_units,
            COALESCE(SUM(${orderItems.quantity}) FILTER (WHERE ${ordersTable.statusId} = ${RETURNED_STATUS_ID}), 0)::int AS returned_units
          FROM ${orderItems}
          JOIN ${ordersTable} ON ${ordersTable.id} = ${orderItems.orderId}
          WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${m.year}
            AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${m.month}
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS units
          FROM ${storeSales}
          WHERE EXTRACT(YEAR FROM ${storeSales.createdAt}) = ${m.year}
            AND EXTRACT(MONTH FROM ${storeSales.createdAt}) = ${m.month}
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(${orderItems.quantity}), 0)::int AS units
          FROM ${orderItems}
          JOIN ${ordersTable} ON ${ordersTable.id} = ${orderItems.orderId}
          WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}
            AND ${ordersTable.source} NOT IN ('k', 'm')
            AND EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${m.year}
            AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${m.month}
        `),
        db.execute(sql`
          SELECT
            EXTRACT(DAY FROM ${ordersTable.createdAt})::int AS day,
            COALESCE(SUM(${MONTANT}) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID}), 0)::float8 AS revenue,
            COUNT(*) FILTER (WHERE ${ordersTable.statusId} = ${DELIVERED_STATUS_ID})::int AS delivered_orders
          FROM ${ordersTable}
          WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${m.year}
            AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${m.month}
          GROUP BY 1
        `),
        db.execute(sql`
          WITH daily_sold AS (
            SELECT EXTRACT(DAY FROM o.created_at)::int AS day, oi.quantity::int AS qty
            FROM ${ordersTable} o
            JOIN ${orderItems} oi ON oi.order_id = o.id
            WHERE o.status_id = ${DELIVERED_STATUS_ID}
              AND EXTRACT(YEAR FROM o.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM o.created_at) = ${m.month}
            UNION ALL
            SELECT EXTRACT(DAY FROM ss.created_at)::int AS day, 1 AS qty
            FROM ${storeSales} ss
            WHERE EXTRACT(YEAR FROM ss.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM ss.created_at) = ${m.month}
          )
          SELECT day, SUM(qty)::int AS units
          FROM daily_sold
          GROUP BY 1
        `),
        db.execute(sql`
          WITH sold AS (
            SELECT oi.shoe_inventory_id AS inv_id, oi.quantity::int AS qty
            FROM ${orderItems} oi
            JOIN ${ordersTable} o ON o.id = oi.order_id
            WHERE o.status_id = ${DELIVERED_STATUS_ID}
              AND EXTRACT(YEAR FROM o.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM o.created_at) = ${m.month}
            UNION ALL
            SELECT ss.shoe_inventory_id AS inv_id, 1 AS qty
            FROM ${storeSales} ss
            WHERE EXTRACT(YEAR FROM ss.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM ss.created_at) = ${m.month}
          )
          SELECT m.model_name AS label, SUM(sold.qty)::int AS units
          FROM sold
          JOIN ${shoeInventory} si ON si.id = sold.inv_id
          JOIN ${shoes} sh ON sh.id = si.shoe_id
          JOIN ${shoeModels} m ON m.id = sh.model_id
          GROUP BY m.model_name
          ORDER BY units DESC
          LIMIT 15
        `),
        db.execute(sql`
          WITH sold AS (
            SELECT oi.shoe_inventory_id AS inv_id, oi.quantity::int AS qty
            FROM ${orderItems} oi
            JOIN ${ordersTable} o ON o.id = oi.order_id
            WHERE o.status_id = ${DELIVERED_STATUS_ID}
              AND EXTRACT(YEAR FROM o.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM o.created_at) = ${m.month}
            UNION ALL
            SELECT ss.shoe_inventory_id AS inv_id, 1 AS qty
            FROM ${storeSales} ss
            WHERE EXTRACT(YEAR FROM ss.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM ss.created_at) = ${m.month}
          )
          SELECT sh.color AS label, SUM(sold.qty)::int AS units
          FROM sold
          JOIN ${shoeInventory} si ON si.id = sold.inv_id
          JOIN ${shoes} sh ON sh.id = si.shoe_id
          GROUP BY sh.color
          ORDER BY units DESC
          LIMIT 15
        `),
        db.execute(sql`
          WITH sold AS (
            SELECT si.size AS size, oi.quantity::int AS qty
            FROM ${orderItems} oi
            JOIN ${ordersTable} o ON o.id = oi.order_id
            JOIN ${shoeInventory} si ON si.id = oi.shoe_inventory_id
            WHERE o.status_id = ${DELIVERED_STATUS_ID}
              AND EXTRACT(YEAR FROM o.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM o.created_at) = ${m.month}
            UNION ALL
            SELECT si.size AS size, 1 AS qty
            FROM ${storeSales} ss
            JOIN ${shoeInventory} si ON si.id = ss.shoe_inventory_id
            WHERE EXTRACT(YEAR FROM ss.created_at) = ${m.year}
              AND EXTRACT(MONTH FROM ss.created_at) = ${m.month}
          )
          SELECT size, SUM(qty)::int AS units
          FROM sold
          GROUP BY size
          ORDER BY size
        `),
        db.execute(sql`
          SELECT ${ordersTable.source} AS source,
                 COUNT(*)::int AS orders
          FROM ${ordersTable}
          WHERE EXTRACT(YEAR FROM ${ordersTable.createdAt}) = ${m.year}
            AND EXTRACT(MONTH FROM ${ordersTable.createdAt}) = ${m.month}
          GROUP BY ${ordersTable.source}
          ORDER BY orders DESC
        `),
      ]);

      const ord = ordersRes.rows[0] as Record<string, unknown>;
      const unitsRow = orderUnitsRes.rows[0] as Record<string, unknown>;
      const storeUnits = n((storeSalesRes.rows[0] as { units: unknown }).units);
      const saifUnits = n((saifPaymentRes.rows[0] as { units: unknown }).units);

      const dailyUnitsMap = new Map<number, number>();
      for (const r of dailyUnitsRes.rows) {
        const row = r as Record<string, unknown>;
        dailyUnitsMap.set(n(row.day), n(row.units));
      }

      const dailyRevenueMap = new Map<number, number>();
      for (const r of dailyOrdersRes.rows) {
        const row = r as Record<string, unknown>;
        dailyRevenueMap.set(n(row.day), n(row.revenue));
      }

      const modelsMap = new Map<string, number>();
      for (const r of modelsRes.rows) {
        const row = r as Record<string, unknown>;
        modelsMap.set(String(row.label), n(row.units));
      }

      const colorsMap = new Map<string, number>();
      for (const r of colorsRes.rows) {
        const row = r as Record<string, unknown>;
        colorsMap.set(String(row.label), n(row.units));
      }

      const sizesMap = new Map<string, number>();
      for (const r of sizesRes.rows) {
        const row = r as Record<string, unknown>;
        sizesMap.set(String(row.size), n(row.units));
      }

      const sourcesMap = new Map<string, number>();
      for (const r of sourcesRes.rows) {
        const row = r as Record<string, unknown>;
        sourcesMap.set(String(row.source ?? ""), n(row.orders));
      }

      return {
        totalOrders: n(ord.total_orders),
        deliveredOrders: n(ord.delivered),
        returnedOrders: n(ord.returned),
        revenue: n(ord.revenue),
        deliveredUnits: n(unitsRow.delivered_units),
        returnedUnits: n(unitsRow.returned_units),
        storeSaleUnits: storeUnits,
        saifPaymentUnits: saifUnits,
        dailyUnitsMap,
        dailyRevenueMap,
        modelsMap,
        colorsMap,
        sizesMap,
        sourcesMap,
      };
    }),
  );

  const totals: MonthTotals[] = months.map((m, idx) => {
    const d = monthData[idx];
    const delivered = d.deliveredOrders;
    const returned = d.returnedOrders;
    return {
      key: m.key,
      year: m.year,
      month: m.month,
      label: m.label,
      unitsSold: d.deliveredUnits + d.storeSaleUnits,
      deliveredOrders: delivered,
      totalOrders: d.totalOrders,
      returnedOrders: returned,
      returnedUnits: d.returnedUnits,
      returnRate: delivered + returned > 0 ? returned / (delivered + returned) : 0,
      successRate: delivered + returned > 0 ? delivered / (delivered + returned) : 0,
      revenue: d.revenue,
      storeSaleUnits: d.storeSaleUnits,
      saifPaymentUnits: d.saifPaymentUnits,
    };
  });

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const dailyUnits: WideRow[] = [];
  const dailyRevenue: WideRow[] = [];
  const cumulativeUnits: WideRow[] = [];
  const cumulativeRevenue: WideRow[] = [];

  const cumUnits = new Map<string, number>();
  const cumRev = new Map<string, number>();
  for (const m of months) {
    cumUnits.set(m.key, 0);
    cumRev.set(m.key, 0);
  }

  for (let day = 1; day <= 31; day++) {
    const dayKey = `Day ${day}`;
    const uRow: WideRow = { key: dayKey };
    const rRow: WideRow = { key: dayKey };
    const cuRow: WideRow = { key: dayKey };
    const crRow: WideRow = { key: dayKey };

    for (let idx = 0; idx < months.length; idx++) {
      const m = months[idx];
      const d = monthData[idx];
      const daysInMonth = new Date(m.year, m.month, 0).getDate();
      const isCurrent = m.year === currentYear && m.month === currentMonth;

      if (day > daysInMonth) {
        continue;
      }
      if (isCurrent && day > currentDay) {
        continue;
      }

      const u = d.dailyUnitsMap.get(day) ?? 0;
      const r = d.dailyRevenueMap.get(day) ?? 0;
      uRow[m.key] = u;
      rRow[m.key] = r;

      const newCU = (cumUnits.get(m.key) ?? 0) + u;
      const newCR = (cumRev.get(m.key) ?? 0) + r;
      cumUnits.set(m.key, newCU);
      cumRev.set(m.key, newCR);
      cuRow[m.key] = newCU;
      crRow[m.key] = newCR;
    }

    dailyUnits.push(uRow);
    dailyRevenue.push(rRow);
    cumulativeUnits.push(cuRow);
    cumulativeRevenue.push(crRow);
  }

  const modelTotals = new Map<string, number>();
  for (const d of monthData) {
    for (const [model, units] of d.modelsMap) {
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + units);
    }
  }
  const topModelNames = Array.from(modelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  const topModels: WideRow[] = topModelNames.map((name) => {
    const row: WideRow = { key: name };
    for (let idx = 0; idx < months.length; idx++) {
      row[months[idx].key] = monthData[idx].modelsMap.get(name) ?? 0;
    }
    return row;
  });

  const colorTotals = new Map<string, number>();
  for (const d of monthData) {
    for (const [color, units] of d.colorsMap) {
      colorTotals.set(color, (colorTotals.get(color) ?? 0) + units);
    }
  }
  const topColorNames = Array.from(colorTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  const topColors: WideRow[] = topColorNames.map((name) => {
    const row: WideRow = { key: name };
    for (let idx = 0; idx < months.length; idx++) {
      row[months[idx].key] = monthData[idx].colorsMap.get(name) ?? 0;
    }
    return row;
  });

  const allSizes = new Set<string>();
  for (const d of monthData) {
    for (const s of d.sizesMap.keys()) allSizes.add(s);
  }
  const sortedSizes = Array.from(allSizes).sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  );
  const sizeDemand: WideRow[] = sortedSizes.map((size) => {
    const row: WideRow = { key: size };
    for (let idx = 0; idx < months.length; idx++) {
      row[months[idx].key] = monthData[idx].sizesMap.get(size) ?? 0;
    }
    return row;
  });

  const allSources = new Set<string>();
  for (const d of monthData) {
    for (const s of d.sourcesMap.keys()) allSources.add(s);
  }
  const bySource: WideRow[] = Array.from(allSources)
    .sort()
    .map((code) => {
      const row: WideRow = { key: SOURCE_LABELS[code] ?? (code || "Unknown") };
      for (let idx = 0; idx < months.length; idx++) {
        row[months[idx].key] = monthData[idx].sourcesMap.get(code) ?? 0;
      }
      return row;
    });

  const outcomeMetrics: {
    key: string;
    get: (d: (typeof monthData)[0]) => number;
  }[] = [
    { key: "Total orders", get: (d) => d.totalOrders },
    { key: "Delivered orders", get: (d) => d.deliveredOrders },
    { key: "Returned orders", get: (d) => d.returnedOrders },
    { key: "Store sales (units)", get: (d) => d.storeSaleUnits },
    { key: "Saif payment (units)", get: (d) => d.saifPaymentUnits },
  ];

  const deliveryOutcomes: WideRow[] = outcomeMetrics.map((om) => {
    const row: WideRow = { key: om.key };
    for (let idx = 0; idx < months.length; idx++) {
      row[months[idx].key] = om.get(monthData[idx]);
    }
    return row;
  });

  return {
    months,
    totals,
    dailyUnits,
    dailyRevenue,
    cumulativeUnits,
    cumulativeRevenue,
    topModels,
    topColors,
    sizeDemand,
    bySource,
    deliveryOutcomes,
  };
}

