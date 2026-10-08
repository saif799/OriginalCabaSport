import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dhdProvider } from "@/lib/delivery/dhd";

type Listed = { tracking: string; status: string };

/**
 * A fake DHD: `pages` is what get/orders lists, 40-a-page style; `info` is what
 * get/trackings/info knows. Unknown trackings are left out of the info answer,
 * the way the real endpoint does it.
 */
function fakeDhd(pages: Listed[][], info: Record<string, string>) {
  const calls: URL[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);

    if (url.pathname.endsWith("/get/orders")) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const data = pages[page - 1] ?? [];
      const next = page < pages.length ? `${url.origin}${url.pathname}?page=${page + 1}` : null;
      return Response.json({ current_page: page, data, next_page_url: next, per_page: 40 });
    }

    if (url.pathname.endsWith("/get/trackings/info")) {
      const asked = url.searchParams.getAll("trackings[]");
      if (asked.length > 100) return Response.json({ success: false }, { status: 422 });
      const body: Record<string, { status: string }> = {};
      for (const t of asked) if (info[t]) body[t] = { status: info[t] };
      return Response.json(body);
    }

    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const infoCalls = (calls: URL[]) => calls.filter((u) => u.pathname.endsWith("/get/trackings/info"));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dhdProvider.fetchStatuses", () => {
  it("reads every page of get/orders, not just the first 40", async () => {
    const page1 = Array.from({ length: 40 }, (_, i) => ({ tracking: `P1-${i}`, status: "en_livraison" }));
    const page2 = [{ tracking: "P2-0", status: "prete_a_expedier" }];
    const calls = fakeDhd([page1, page2], {});

    const statuses = await dhdProvider.fetchStatuses({ all: [], inFlight: [] });

    expect(statuses).toHaveLength(41);
    expect(statuses).toContainEqual({ tracking: "P2-0", status: "prete_a_expedier" });
    expect(calls.map((u) => u.searchParams.get("page"))).toEqual(["1", "2"]);
  });

  it("looks up in-flight orders the listing no longer carries, and only those", async () => {
    const calls = fakeDhd([[{ tracking: "LISTED", status: "en_livraison" }]], {
      LISTED: "En livraison",
      DROPPED: "Livre non encaissé",
    });

    const statuses = await dhdProvider.fetchStatuses({
      all: ["LISTED", "DROPPED", "SETTLED"],
      inFlight: ["LISTED", "DROPPED"],
    });

    expect(statuses).toEqual([
      { tracking: "LISTED", status: "en_livraison" },
      { tracking: "DROPPED", status: "Livre non encaissé" },
    ]);
    expect(infoCalls(calls).map((u) => u.searchParams.getAll("trackings[]"))).toEqual([["DROPPED"]]);
  });

  it("asks trackings/info at most 100 trackings at a time", async () => {
    const inFlight = Array.from({ length: 250 }, (_, i) => `T${i}`);
    const calls = fakeDhd([[]], Object.fromEntries(inFlight.map((t) => [t, "Retours prêts"])));

    const statuses = await dhdProvider.fetchStatuses({ all: inFlight, inFlight });

    expect(statuses).toHaveLength(250);
    expect(infoCalls(calls).map((u) => u.searchParams.getAll("trackings[]").length)).toEqual([100, 100, 50]);
  });

  it("makes no trackings/info call when every in-flight order is listed", async () => {
    const calls = fakeDhd([[{ tracking: "A", status: "vers_wilaya" }]], {});

    await dhdProvider.fetchStatuses({ all: ["A"], inFlight: ["A"] });

    expect(infoCalls(calls)).toHaveLength(0);
  });

  it("returns one status per parcel when a parcel straddles two pages", async () => {
    fakeDhd(
      [
        [{ tracking: "SHIFTED", status: "en_livraison" }],
        [{ tracking: "SHIFTED", status: "retour_en_traitement" }],
      ],
      {},
    );

    const statuses = await dhdProvider.fetchStatuses({ all: [], inFlight: [] });

    expect(statuses).toEqual([{ tracking: "SHIFTED", status: "retour_en_traitement" }]);
  });

  it("still returns the listing when the trackings/info lookup fails", async () => {
    fakeDhd([[{ tracking: "LISTED", status: "en_livraison" }]], {});
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request) =>
      String(input).includes("/get/trackings/info")
        ? new Response("boom", { status: 500 })
        : realFetch(input),
    );

    const statuses = await dhdProvider.fetchStatuses({ all: ["LISTED", "DROPPED"], inFlight: ["DROPPED"] });

    expect(statuses).toEqual([{ tracking: "LISTED", status: "en_livraison" }]);
  });
});
