"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { trackGtag } from "@/lib/storefront/gtag";

/**
 * Loads the Google Analytics 4 tag (gtag.js) and keeps page_view in sync with App Router navigation.
 *
 * Mounted from the storefront route group's layout, never the root layout —
 * the root layout is shared with /admin, and /admin must never load this.
 */
export default function GoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  // The inline snippet below already fires an initial page_view on script init.
  // Without this guard the effect fires a second one on hydration and every
  // session shows double the pageviews it had.
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    trackGtag("page_view", {
      page_path: pathname,
    });
  }, [pathname]);

  return (
    <>
      <Script
        id="google-analytics-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
      />
      <Script id="google-analytics-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
