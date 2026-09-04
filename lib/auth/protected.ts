/**
 * Which paths the admin session gates, and which stay open.
 *
 * Runtime-neutral (no `next/headers`, no Node built-ins) so `proxy.ts` on the
 * Edge and the route handlers on Node share one answer. Keeping the allowlist
 * in a single named place is deliberate: the failure mode of scattering it is
 * that someone adds a public route and silently opens a mutation.
 *
 * The default is CLOSED. A new route under /api is protected the moment it
 * exists; opening it takes an edit here.
 */

/** `/admin` and everything under it. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The login screen itself, which obviously cannot require being logged in. */
export function isLoginPath(pathname: string): boolean {
  return pathname === "/admin/login";
}

/**
 * The routes the *public storefront* calls over HTTP. This list is short
 * because storefront pages read the database directly — only the checkout
 * form talks to the API at all.
 *
 *   POST /api/order      the checkout submission itself.
 *   GET  /api/coverage   wilaya/commune/tarif lookup as the customer types.
 *
 * Method matters: /api/order also exports an admin-only GET and DELETE, so a
 * path-only allowlist here would hand anyone the ability to delete orders.
 */
export function isPublicApiRequest(pathname: string, method: string): boolean {
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/order") return method === "POST";
  if (pathname === "/api/coverage") return method === "GET";
  return false;
}

/**
 * The one route with two legitimate callers: the Vercel nightly cron and the
 * admin "sync now" button. It accepts either credential — see `isCronRequest`.
 */
export function isCronSharedPath(pathname: string): boolean {
  return pathname === "/api/status";
}
