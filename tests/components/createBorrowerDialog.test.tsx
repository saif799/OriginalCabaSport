// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateBorrowerDialog from "@/components/CreateBorrowerDialog";
import { toast } from "sonner";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  mockRefresh.mockClear();
  vi.clearAllMocks();

  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CreateBorrowerDialog", () => {
  it("renders the trigger button", () => {
    render(<CreateBorrowerDialog />);
    expect(screen.getByRole("button", { name: /add borrower/i })).toBeTruthy();
  });

  it("opens the dialog and submits a new borrower", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "borrower-1", name: "Yacine" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateBorrowerDialog />);

    await user.click(screen.getByRole("button", { name: /add borrower/i }));

    const input = screen.getByLabelText(/name/i);
    expect(input).toBeTruthy();

    await user.type(input, "Yacine");

    const submitBtn = screen.getByRole("button", { name: "Add borrower" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/borrowers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Yacine" }),
      });
      expect(toast.success).toHaveBeenCalledWith("Borrower added successfully.");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("displays an error toast when creation fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "A borrower with that name already exists" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateBorrowerDialog />);

    await user.click(screen.getByRole("button", { name: /add borrower/i }));
    const input = screen.getByLabelText(/name/i);
    await user.type(input, "Yacine");

    const submitBtn = screen.getByRole("button", { name: "Add borrower" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("A borrower with that name already exists");
    });
  });
});
