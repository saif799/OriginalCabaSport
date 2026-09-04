import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "@/proxy";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { DEFAULT_LOCALE } from "@/i18n.config";

/**
 * Covers the auth half of proxy.ts and, just as importantly, its `matcher`.
 *
 * The matcher is the fragile part: it used to exclude `admin|api` outright, and
 * if it ever excludes them again the gate goes dead with no error anywhere —
 * every admin page and API route silently reopens. `matches()` below replays
 * the real regex so that regression fails a test instead of shipping.
 */

const ORIGIN = "http://localhost:3000";
const matcher = new RegExp(`^${config.matcher[0]}$`);
const matches = (pathname: string) => matcher.test(pathname);

function request(
  pathname: string,
  init?: { method?: string; cookie?: string; bearer?: string },
) {
  const headers = new Headers();
  if (init?.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  if (init?.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  return new NextRequest(new URL(pathname, ORIGIN), {
    method: init?.method ?? "GET",
    headers,
  });
}

let validToken: string;

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.CRON_SECRET = "test-cron";
  validToken = await createSessionToken();
});

describe("matcher", () => {
  it("covers the admin surface it is supposed to gate", () => {
    expect(matches("/admin")).toBe(true);
    expect(matches("/admin/orders")).toBe(true);
    expect(matches("/api/store-sales")).toBe(true);
  });

  it("still covers the storefront it has always routed", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/ar/products")).toBe(true);
  });

  it("still spares Next internals and the SEO files", () => {
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/sitemap.xml")).toBe(false);
    expect(matches("/robots.txt")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });

  /**
   * The dev HMR socket. `_next/static|_next/image` did not cover it, so it was
   * being redirected to /fr/_next/webpack-hmr and failing every reconnect.
   */
  it("spares the HMR socket", () => {
    expect(matches("/_next/webpack-hmr")).toBe(false);
  });
});

describe("unauthenticated", () => {
  it("redirects an admin page to the login screen, remembering where it was going", async () => {
    const res = await proxy(request("/admin/orders"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/admin/login");
    expect(location.searchParams.get("next")).toBe("/admin/orders");
  });

  it("401s an API route rather than redirecting it", async () => {
    const res = await proxy(request("/api/store-sales", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("lets the login page itself through", async () => {
    expect((await proxy(request("/admin/login"))).status).toBe(200);
  });
});

describe("the storefront's public API surface", () => {
  it("admits the checkout submission", async () => {
    expect(
      (await proxy(request("/api/order", { method: "POST" }))).status,
    ).toBe(200);
  });

  it("admits coverage lookups", async () => {
    expect((await proxy(request("/api/coverage?list=wilayas"))).status).toBe(
      200,
    );
  });

  /**
   * The catalog routes used to be admitted here. They were deleted (issue #19)
   * — the storefront pages read the database directly, so nothing called them,
   * and leaving them open let anyone mirror the whole catalog with one curl.
   */
  it("does NOT admit the deleted catalog routes", async () => {
    expect((await proxy(request("/api/products"))).status).toBe(401);
    expect((await proxy(request("/api/products/AF1-WHITE"))).status).toBe(401);
  });

  /**
   * The reason the allowlist is method-aware. /api/order shares one path
   * between the public checkout POST and an admin-only DELETE; a path-only
   * allowlist here would hand anyone the ability to delete orders.
   */
  it("does NOT admit the admin methods on a shared path", async () => {
    expect(
      (await proxy(request("/api/order", { method: "DELETE" }))).status,
    ).toBe(401);
    expect((await proxy(request("/api/order", { method: "GET" }))).status).toBe(
      401,
    );
  });

  it("closes new API routes by default", async () => {
    expect((await proxy(request("/api/something-added-later"))).status).toBe(
      401,
    );
  });
});

describe("authenticated", () => {
  it("lets a valid session through to an admin page and an API route", async () => {
    expect(
      (await proxy(request("/admin/orders", { cookie: validToken }))).status,
    ).toBe(200);
    expect(
      (await proxy(request("/api/rebalance", { cookie: validToken }))).status,
    ).toBe(200);
  });

  it("rejects a forged signature", async () => {
    const [payload] = validToken.split(".");
    const res = await proxy(
      request("/api/rebalance", { cookie: `${payload}.forged` }),
    );
    expect(res.status).toBe(401);
  });

  /**
   * Signed with the real secret, so the only thing wrong with this token is
   * its age. Without the signing step the test would pass for the wrong
   * reason — a bad signature — and expiry would go unchecked.
   */
  it("rejects an expired token even though it is correctly signed", async () => {
    const expired = String(Math.floor(Date.now() / 1000) - 60);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(process.env.AUTH_SECRET!),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const raw = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(expired),
    );
    const signature = btoa(String.fromCharCode(...new Uint8Array(raw)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await proxy(
      request("/api/rebalance", { cookie: `${expired}.${signature}` }),
    );
    expect(res.status).toBe(401);
  });
});

describe("/api/status, the two-caller route", () => {
  it("admits the Vercel cron's bearer token without a cookie", async () => {
    expect(
      (await proxy(request("/api/status", { bearer: "test-cron" }))).status,
    ).toBe(200);
  });

  it("admits a logged-in admin without a bearer token", async () => {
    expect(
      (await proxy(request("/api/status", { cookie: validToken }))).status,
    ).toBe(200);
  });

  it("rejects a wrong bearer token", async () => {
    expect(
      (await proxy(request("/api/status", { bearer: "wrong" }))).status,
    ).toBe(401);
  });
});

describe("storefront locale routing still works", () => {
  it("sends the front door to the default locale", async () => {
    const res = await proxy(request("/"));
    expect(res.status).toBe(307);
    // Read from the config rather than hardcoded: which locale is the routing
    // default is an i18n decision, not something this gate test should pin.
    expect(new URL(res.headers.get("location")!).pathname).toBe(`/${DEFAULT_LOCALE}`);
  });

  it("sends a bare deep path to French, permanently", async () => {
    const res = await proxy(request("/products"));
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/fr/products");
  });

  it("passes an already-localised path straight through", async () => {
    expect((await proxy(request("/ar/products"))).status).toBe(200);
  });
});
