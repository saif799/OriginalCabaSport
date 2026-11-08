/**
 * Global type declarations and caller helper for Google Analytics 4 (gtag.js).
 */

type GtagFn = {
  (command: "config", targetId: string, config?: Record<string, unknown>): void;
  (command: "set", config: Record<string, unknown>): void;
  (command: "js", date: Date): void;
  (command: "event", eventName: string, eventParams?: Record<string, unknown>): void;
  (...args: unknown[]): void;
};

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

/**
 * Fire a Google Analytics 4 event.
 * No-ops when gtag is absent (e.g. GA_MEASUREMENT_ID is unset, SSR, or ad blocker enabled),
 * so callers never need to guard.
 */
export function trackGtag(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", eventName, params ?? {});
}
