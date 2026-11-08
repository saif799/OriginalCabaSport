"use client";

import { useEffect } from "react";
import { trackViewItem } from "@/lib/storefront/analytics";

/**
 * Reports a product-page view to Meta (ViewContent) and GA4 (view_item).
 * Renders nothing — it exists only because the product page itself is a server component.
 *
 * `value` is the headline price the page displays (the minimum resolved price
 * across in-stock sizes), since no size is chosen yet at view time.
 */
export default function ViewContentTracker({
  shoeId,
  contentName,
  value,
}: {
  shoeId: string;
  contentName: string;
  value: number;
}) {
  useEffect(() => {
    trackViewItem({
      shoeId,
      contentName,
      value,
    });
  }, [shoeId, contentName, value]);

  return null;
}
