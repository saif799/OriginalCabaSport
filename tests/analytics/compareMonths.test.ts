import { describe, expect, it, vi } from "vitest";

// Mock db.execute before importing lib/analytics
vi.mock("@/lib/db", () => {
  return {
    db: {
      execute: vi.fn(async (query: any) => {
        const sqlStr = typeof query === "string" ? query : query?.queryChunks?.[0] ?? "";
        return {
          rows: [
            {
              y: 2026,
              m: 11,
              total_orders: 100,
              delivered: 80,
              returned: 10,
              revenue: 500000,
              delivered_units: 95,
              returned_units: 12,
              units: 15,
              day: 1,
              label: "Adidas Samba",
              color: "Black",
              size: "42",
              source: "i",
            },
          ],
        };
      }),
    },
  };
});

import { getAvailableMonthOptions, getMonthComparison } from "@/lib/analytics";

describe("compare months analytics", () => {
  it("returns available month options as key/label pairs", async () => {
    const options = await getAvailableMonthOptions();
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBeGreaterThan(0);
    const first = options[0];
    expect(first.key).toBe("2026-11");
    expect(first.year).toBe(2026);
    expect(first.month).toBe(11);
    expect(first.label).toBe("November 2026");
    expect(first.shortLabel).toBe("Nov 2026");
  });

  it("returns empty comparison when given empty or invalid keys", async () => {
    const resEmpty = await getMonthComparison([]);
    expect(resEmpty.months).toEqual([]);
    expect(resEmpty.totals).toEqual([]);
    expect(resEmpty.dailyUnits).toEqual([]);

    const resInvalid = await getMonthComparison(["invalid", "2020-99", "abc"]);
    expect(resInvalid.months).toEqual([]);
    expect(resInvalid.totals).toEqual([]);
  });

  it("builds daily time series and comparative metrics for valid months", async () => {
    const comp = await getMonthComparison(["2026-10", "2026-11"]);
    expect(comp.months.length).toBe(2);
    expect(comp.totals.length).toBe(2);

    expect(comp.months[0].key).toBe("2026-10");
    expect(comp.months[1].key).toBe("2026-11");

    // Colors assigned from palette
    expect(comp.months[0].color).toBe("var(--chart-1)");
    expect(comp.months[1].color).toBe("var(--chart-2)");

    // Daily series contains 31 days
    expect(comp.dailyUnits.length).toBe(31);
    expect(comp.dailyRevenue.length).toBe(31);
    expect(comp.cumulativeUnits.length).toBe(31);
    expect(comp.cumulativeRevenue.length).toBe(31);

    expect(comp.dailyUnits[0].key).toBe("Day 1");
    expect(comp.dailyUnits[30].key).toBe("Day 31");

    // Totals calculated properly
    const novTotal = comp.totals.find((t) => t.key === "2026-11");
    expect(novTotal).toBeDefined();
    expect(novTotal?.deliveredOrders).toBe(80);
    expect(novTotal?.returnedOrders).toBe(10);
    expect(novTotal?.revenue).toBe(500000);

    // Delivery outcomes contains key operational metrics
    const outcomeKeys = comp.deliveryOutcomes.map((o) => o.key);
    expect(outcomeKeys).toContain("Total orders");
    expect(outcomeKeys).toContain("Delivered orders");
    expect(outcomeKeys).toContain("Returned orders");
    expect(outcomeKeys).toContain("Store sales (units)");
    expect(outcomeKeys).toContain("Saif payment (units)");
  });
});
