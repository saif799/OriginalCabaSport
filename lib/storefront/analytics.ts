/**
 * Unified storefront tracking layer.
 * Dispatches standard ecommerce events to both Meta Pixel and Google Analytics 4.
 */

import {
  CURRENCY,
  initWithPhone,
  track as trackMeta,
  type PixelContent,
} from "@/lib/storefront/pixel";
import { trackGtag } from "@/lib/storefront/gtag";

export { CURRENCY, initWithPhone, type PixelContent };

/**
 * Route change pageview tracking.
 */
export function trackPageView(pathname: string): void {
  trackMeta("PageView");
  trackGtag("page_view", {
    page_path: pathname,
  });
}

/**
 * Product detail view: Meta ViewContent + GA4 view_item.
 */
export function trackViewItem({
  shoeId,
  contentName,
  value,
}: {
  shoeId: string;
  contentName: string;
  value: number;
}): void {
  trackMeta("ViewContent", {
    content_ids: [shoeId],
    content_type: "product",
    content_name: contentName,
    value,
    currency: CURRENCY,
  });

  trackGtag("view_item", {
    currency: CURRENCY,
    value,
    items: [
      {
        item_id: shoeId,
        item_name: contentName,
        price: value,
        quantity: 1,
      },
    ],
  });
}

/**
 * Order form submit intent: Meta InitiateCheckout + GA4 begin_checkout.
 */
export function trackBeginCheckout({
  shoeId,
  contentName,
  size,
  value,
}: {
  shoeId: string;
  contentName?: string;
  size?: string;
  value: number;
}): void {
  trackMeta("InitiateCheckout", {
    content_ids: [shoeId],
    content_type: "product",
    contents: [{ id: shoeId, quantity: 1, item_price: value }],
    value,
    currency: CURRENCY,
    num_items: 1,
  });

  const item: Record<string, unknown> = {
    item_id: shoeId,
    price: value,
    quantity: 1,
  };
  if (contentName) item.item_name = contentName;
  if (size) item.item_variant = size;

  trackGtag("begin_checkout", {
    currency: CURRENCY,
    value,
    items: [item],
  });
}

/**
 * Completed order confirmation: Meta Purchase + GA4 purchase.
 */
export function trackPurchase({
  eventId,
  value,
  contentIds,
  contents,
}: {
  eventId: string;
  value: number;
  contentIds: string[];
  contents: PixelContent[];
}): void {
  trackMeta(
    "Purchase",
    {
      value,
      currency: CURRENCY,
      content_type: "product",
      content_ids: contentIds,
      contents,
      num_items: contents.reduce((sum, c) => sum + c.quantity, 0),
    },
    eventId,
  );

  trackGtag("purchase", {
    transaction_id: eventId,
    value,
    currency: CURRENCY,
    items: contents.map((c) => ({
      item_id: c.id,
      price: c.item_price,
      quantity: c.quantity,
    })),
  });
}
