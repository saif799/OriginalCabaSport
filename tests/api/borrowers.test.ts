import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../testDb";
import { requireAdmin } from "@/lib/auth/guard";
import { borrower } from "@/lib/schema";

let testDb: TestDb;

vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/stock/revalidate", () => ({
  revalidateStockPaths: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({} as any, {
    get: (_t, prop) => (testDb as any)[prop],
  }),
}));

import { GET, POST } from "@/app/api/borrowers/route";

beforeEach(async () => {
  testDb = await createTestDb();
  vi.mocked(requireAdmin).mockResolvedValue(null);
});

describe("GET /api/borrowers", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns borrowers ordered by name", async () => {
    await testDb.insert(borrower).values([
      { name: "Zack" },
      { name: "Alice" },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe("Alice");
    expect(data[1].name).toBe("Zack");
  });
});

describe("POST /api/borrowers", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = new Request("http://localhost/api/borrowers", {
      method: "POST",
      body: JSON.stringify({ name: "Bob" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("validates missing or empty name", async () => {
    const req = new Request("http://localhost/api/borrowers", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Name is required");
  });

  it("validates name length over 80 characters", async () => {
    const req = new Request("http://localhost/api/borrowers", {
      method: "POST",
      body: JSON.stringify({ name: "a".repeat(81) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("80 characters or fewer");
  });

  it("rejects duplicate borrower names case-insensitively", async () => {
    await testDb.insert(borrower).values({ name: "Karim" });

    const req = new Request("http://localhost/api/borrowers", {
      method: "POST",
      body: JSON.stringify({ name: "karim" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("A borrower with that name already exists");
  });

  it("creates a new borrower and returns 201", async () => {
    const req = new Request("http://localhost/api/borrowers", {
      method: "POST",
      body: JSON.stringify({ name: "  Yacine  " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe("Yacine");
    expect(json.id).toBeDefined();

    const rows = await testDb.select().from(borrower);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Yacine");
  });
});
