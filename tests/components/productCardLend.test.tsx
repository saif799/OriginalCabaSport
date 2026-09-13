// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductCard from "@/components/productCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({}),
}));

const product = {
  modelId: "m1",
  modelName: "Air Force 1",
  color: "White",
  shoeId: "AF1-WHT",
  archived: false,
  primaryImageUrl: null,
  sizes: [
    { inventoryId: "inv-1", size: "42", quantity: 3 },
    { inventoryId: "inv-2", size: "43", quantity: 2 },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

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

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/lended-shoes")) {
        return new Response(
          JSON.stringify([
            { inventoryId: "inv-1", lentQuantity: 0 },
            { inventoryId: "inv-2", lentQuantity: 0 },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("/api/borrowers")) {
        return new Response(JSON.stringify([{ id: "b1", name: "Karim" }]), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("[]", {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

async function openMenu(u: ReturnType<typeof user>) {
  await u.click(screen.getByRole("button", { name: /open menu/i }));
  await screen.findByRole("menu");
}

function lendItem() {
  return screen
    .getAllByRole("menuitem")
    .find((el) => /lend/i.test(el.textContent ?? ""))!;
}

describe("ProductCard lend action", () => {
  it("opens the lend dialog when the Lend menu item is activated", async () => {
    render(<ProductCard product={product} selectshoe={vi.fn()} />);
    const u = user();
    await openMenu(u);

    // Activate the menu item itself (what a click on the row's padding, or a
    // keyboard Enter, does) rather than the inner text node.
    await u.click(lendItem());

    expect(
      await screen.findByRole("heading", { name: /lend/i }),
    ).toBeTruthy();
  });

  it("stays open when the user clicks inside the dialog", async () => {
    render(<ProductCard product={product} selectshoe={vi.fn()} />);
    const u = user();
    await openMenu(u);
    await u.click(lendItem());
    const heading = await screen.findByRole("heading", { name: /lend/i });

    await u.click(heading);
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByRole("heading", { name: /lend/i })).not.toBeNull();
  });

  it("can be reopened after a first attempt", async () => {
    render(<ProductCard product={product} selectshoe={vi.fn()} />);
    const u = user();
    await openMenu(u);
    await u.click(lendItem());
    await screen.findByRole("heading", { name: /lend/i });

    await u.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /lend/i })).toBeNull(),
    );

    await openMenu(u);
    await u.click(lendItem());
    expect(await screen.findByRole("heading", { name: /lend/i })).toBeTruthy();
  });
});
