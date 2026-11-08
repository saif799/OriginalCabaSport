// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  trackBeginCheckout,
  trackPageView,
  trackPurchase,
  trackViewItem,
} from "@/lib/storefront/analytics";
import { trackGtag } from "@/lib/storefront/gtag";

describe("storefront analytics", () => {
  let mockFbq: ReturnType<typeof vi.fn>;
  let mockGtag: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFbq = vi.fn();
    mockGtag = vi.fn();
    window.fbq = mockFbq as unknown as typeof window.fbq;
    window.gtag = mockGtag as unknown as typeof window.gtag;
  });

  describe("trackGtag", () => {
    it("no-ops when window.gtag is absent", () => {
      delete window.gtag;
      expect(() => trackGtag("test_event", { foo: "bar" })).not.toThrow();
    });

    it("dispatches event to window.gtag", () => {
      trackGtag("custom_event", { test_key: 123 });
      expect(mockGtag).toHaveBeenCalledWith("event", "custom_event", {
        test_key: 123,
      });
    });
  });

  describe("trackPageView", () => {
    it("fires PageView on Meta and page_view on GA4", () => {
      trackPageView("/fr/product/123");
      expect(mockFbq).toHaveBeenCalledWith("track", "PageView", {});
      expect(mockGtag).toHaveBeenCalledWith("event", "page_view", {
        page_path: "/fr/product/123",
      });
    });
  });

  describe("trackViewItem", () => {
    it("fires ViewContent on Meta and view_item on GA4 with formatted item", () => {
      trackViewItem({
        shoeId: "shoe-1",
        contentName: "Air Force 1 Triple White",
        value: 12000,
      });

      expect(mockFbq).toHaveBeenCalledWith("track", "ViewContent", {
        content_ids: ["shoe-1"],
        content_type: "product",
        content_name: "Air Force 1 Triple White",
        value: 12000,
        currency: "DZD",
      });

      expect(mockGtag).toHaveBeenCalledWith("event", "view_item", {
        currency: "DZD",
        value: 12000,
        items: [
          {
            item_id: "shoe-1",
            item_name: "Air Force 1 Triple White",
            price: 12000,
            quantity: 1,
          },
        ],
      });
    });
  });

  describe("trackBeginCheckout", () => {
    it("fires InitiateCheckout on Meta and begin_checkout on GA4", () => {
      trackBeginCheckout({
        shoeId: "shoe-1",
        contentName: "Air Force 1 Triple White",
        size: "42",
        value: 12000,
      });

      expect(mockFbq).toHaveBeenCalledWith("track", "InitiateCheckout", {
        content_ids: ["shoe-1"],
        content_type: "product",
        contents: [{ id: "shoe-1", quantity: 1, item_price: 12000 }],
        value: 12000,
        currency: "DZD",
        num_items: 1,
      });

      expect(mockGtag).toHaveBeenCalledWith("event", "begin_checkout", {
        currency: "DZD",
        value: 12000,
        items: [
          {
            item_id: "shoe-1",
            item_name: "Air Force 1 Triple White",
            item_variant: "42",
            price: 12000,
            quantity: 1,
          },
        ],
      });
    });
  });

  describe("trackPurchase", () => {
    it("fires Purchase on Meta and purchase on GA4 with transaction_id and items", () => {
      trackPurchase({
        eventId: "ORD-9999",
        value: 24000,
        contentIds: ["shoe-1", "shoe-2"],
        contents: [
          { id: "shoe-1", quantity: 1, item_price: 12000 },
          { id: "shoe-2", quantity: 1, item_price: 12000 },
        ],
      });

      expect(mockFbq).toHaveBeenCalledWith(
        "track",
        "Purchase",
        {
          value: 24000,
          currency: "DZD",
          content_type: "product",
          content_ids: ["shoe-1", "shoe-2"],
          contents: [
            { id: "shoe-1", quantity: 1, item_price: 12000 },
            { id: "shoe-2", quantity: 1, item_price: 12000 },
          ],
          num_items: 2,
        },
        { eventID: "ORD-9999" },
      );

      expect(mockGtag).toHaveBeenCalledWith("event", "purchase", {
        transaction_id: "ORD-9999",
        value: 24000,
        currency: "DZD",
        items: [
          { item_id: "shoe-1", price: 12000, quantity: 1 },
          { item_id: "shoe-2", price: 12000, quantity: 1 },
        ],
      });
    });
  });
});
