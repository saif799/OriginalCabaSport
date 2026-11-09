// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ProductCard from "@/components/storefront/ProductCard";
import type { StorefrontProduct } from "@/lib/storefront/products";

// Mock next/navigation
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// Mock i18n
vi.mock("@/app/i18n/client", () => ({
  useT: () => ({ t: (key: string, opts?: any) => key }),
  useLocalePath: () => (path: string) => `/fr${path}`,
}));

afterEach(() => {
  cleanup();
  mockSearchParams = new URLSearchParams();
});

describe("ProductCard display price resolution", () => {
  const product: StorefrontProduct = {
    shoeId: "shoe-1",
    modelId: "model-1",
    modelName: "Air Max",
    color: "Black",
    price: 20000,
    compareAtPrice: null,
    minPrice: 17000,
    primaryImageUrl: "https://example.com/shoe.jpg",
    primaryImageAlt: "Air Max Black",
    sizes: [
      { inventoryId: "inv-40", size: "40", quantity: 2, resolvedPrice: 17000 },
      { inventoryId: "inv-41", size: "41", quantity: 3, resolvedPrice: 20000 },
      { inventoryId: "inv-42", size: "42", quantity: 5, resolvedPrice: 20000 },
      { inventoryId: "inv-43", size: "43", quantity: 1, resolvedPrice: 20000 },
      { inventoryId: "inv-44", size: "44", quantity: 4, resolvedPrice: 20000 },
    ],
    newestAt: "2026-01-01",
  };

  it("shows the default price (20 000 DA) when no size filter is selected", () => {
    render(<ProductCard product={product} selectedSizes={[]} />);
    expect(screen.getByText("20 000 DA")).toBeDefined();
    expect(screen.queryByText("17 000 DA")).toBeNull();
  });

  it("shows the override price (17 000 DA) when size 40 is selected in filter", () => {
    render(<ProductCard product={product} selectedSizes={[40]} />);
    expect(screen.getByText("17 000 DA")).toBeDefined();
    expect(screen.queryByText("20 000 DA")).toBeNull();
  });

  it("shows the higher price (20 000 DA) on collision when both 40 and 41 are selected", () => {
    render(<ProductCard product={product} selectedSizes={[40, 41]} />);
    expect(screen.getByText("20 000 DA")).toBeDefined();
    expect(screen.queryByText("17 000 DA")).toBeNull();
  });

  it("reads selected sizes from searchParams when selectedSizes prop is not provided", () => {
    mockSearchParams = new URLSearchParams("sizes=40");
    render(<ProductCard product={product} />);
    expect(screen.getByText("17 000 DA")).toBeDefined();
  });

  it("shows default price when searchParams has no sizes", () => {
    mockSearchParams = new URLSearchParams("");
    render(<ProductCard product={product} />);
    expect(screen.getByText("20 000 DA")).toBeDefined();
  });

  it("resolves collision from searchParams to the higher price", () => {
    mockSearchParams = new URLSearchParams("sizes=40,41");
    render(<ProductCard product={product} />);
    expect(screen.getByText("20 000 DA")).toBeDefined();
  });
});
