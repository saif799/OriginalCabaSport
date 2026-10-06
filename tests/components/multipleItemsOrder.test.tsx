// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MultipleItemsOrder from "@/components/multipleItemsOrder";

const shoe = {
  modelId: "m1",
  modelName: "Air Force 1",
  color: "White",
  shoeId: "AF1-WHT",
  sizes: [{ inventoryId: "inv-1", size: "42", quantity: 3 }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Each Delivery Provider covers a different Commune in the same Wilaya, so a
// test can tell whose Coverage the form is offering.
const COMMUNE_BY_PROVIDER: Record<string, string> = {
  dhd: "Bab Ezzouar",
  yalidine: "Hydra",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let postedOrders: Array<Record<string, unknown>>;
let orderResponse: () => Response;

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  postedOrders = [];
  orderResponse = () => json({ orderId: "TRACK-1" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://test.local");
      if (url.pathname === "/api/coverage") {
        const provider = url.searchParams.get("provider") ?? "";
        if (url.searchParams.get("list") === "wilayas") {
          return json({ wilayas: [{ wilayaId: 16, name: "Alger" }] });
        }
        return json({
          communes: [
            {
              name: COMMUNE_BY_PROVIDER[provider],
              modes: {
                home: { available: true, fee: 600 },
                desk: { available: true, fee: 400 },
              },
            },
          ],
        });
      }
      if (url.pathname === "/api/order" && init?.method === "POST") {
        postedOrders.push(JSON.parse(String(init.body)));
        return orderResponse();
      }
      return json([]);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

async function pick(
  u: ReturnType<typeof user>,
  trigger: HTMLElement,
  option: string,
) {
  await u.click(trigger);
  await u.click(await screen.findByRole("option", { name: option }));
}

/** Fill everything but the Delivery Provider and Delivery Mode, then submit. */
async function fillAndSubmit(u: ReturnType<typeof user>, commune: string) {
  await u.type(screen.getByLabelText(/client name/i), "Ahmed Ben Ali");
  await u.type(screen.getByLabelText(/phone number/i), "0555123456");
  await u.type(screen.getByLabelText(/amount/i), "4500");

  await pick(
    u,
    screen.getByRole("combobox", { name: /wilaya/i }),
    "16 - Alger",
  );
  await pick(
    u,
    screen.getByRole("combobox", { name: /commune/i }),
    commune,
  );

  await u.click(screen.getByText(/select a shoe/i));
  await u.click(await screen.findByRole("option", { name: /air force 1/i }));

  await u.click(screen.getByRole("button", { name: /create order/i }));
  await waitFor(() => expect(postedOrders).toHaveLength(1));
  return postedOrders[0];
}

describe("MultipleItemsOrder Delivery Provider", () => {
  it("places the order with DHD by default", async () => {
    render(<MultipleItemsOrder shoes={[shoe]} />);
    const u = user();
    await u.click(screen.getByRole("button", { name: /add an order/i }));

    const order = await fillAndSubmit(u, COMMUNE_BY_PROVIDER.dhd);

    expect(order).toMatchObject({
      provider: "dhd",
      commune: COMMUNE_BY_PROVIDER.dhd,
      selectedSizeShoeId: ["inv-1"],
    });
  });

  it("places a desk order with Yalidine, against Yalidine's Coverage", async () => {
    render(<MultipleItemsOrder shoes={[shoe]} />);
    const u = user();
    await u.click(screen.getByRole("button", { name: /add an order/i }));

    // Home chosen first: Yalidine must force the Delivery Mode back to desk.
    await pick(
      u,
      screen.getByRole("combobox", { name: /delivery type/i }),
      "a domicile",
    );
    await pick(
      u,
      screen.getByRole("combobox", { name: /delivery company/i }),
      "Yalidine (stop desk)",
    );

    const deliveryType = screen.getByRole("combobox", {
      name: /delivery type/i,
    });
    expect(deliveryType.textContent).toMatch(/bureau/i);
    expect(deliveryType.hasAttribute("disabled")).toBe(true);

    const order = await fillAndSubmit(u, COMMUNE_BY_PROVIDER.yalidine);

    expect(order).toMatchObject({
      provider: "yalidine",
      stop_desk: 1,
      commune: COMMUNE_BY_PROVIDER.yalidine,
      selectedSizeShoeId: ["inv-1"],
    });
  });

  it("shows why the courier refused the parcel", async () => {
    const refusal =
      'Failed to create order: Yalidine commune "Hydra" has no stop-desk center';
    orderResponse = () => json({ error: refusal }, 502);
    render(<MultipleItemsOrder shoes={[shoe]} />);
    const u = user();
    await u.click(screen.getByRole("button", { name: /add an order/i }));
    await pick(
      u,
      screen.getByRole("combobox", { name: /delivery company/i }),
      "Yalidine (stop desk)",
    );

    await fillAndSubmit(u, COMMUNE_BY_PROVIDER.yalidine);

    expect(await screen.findByText(refusal)).toBeTruthy();
  });
});
