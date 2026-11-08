// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeliveryRecordBadge } from "@/app/admin/(admin)/orders/DeliveryRecordBadge";
import type { DeliveryRecord } from "@/lib/orders/deliveryRecord";

afterEach(() => {
  cleanup();
});

describe("DeliveryRecordBadge", () => {
  const record: DeliveryRecord = {
    state: "clean",
    delivered: 3,
    returned: 0,
  };

  it("renders delivered and returned counts", () => {
    render(<DeliveryRecordBadge record={record} />);
    expect(screen.getByText("3 ✓")).toBeDefined();
    expect(screen.getByText("0 ↩")).toBeDefined();
  });

  it("renders non-button badge when onClick is not provided", () => {
    const { container } = render(<DeliveryRecordBadge record={record} />);
    expect(screen.queryByRole("button")).toBeNull();
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge?.getAttribute("title")).toBe("Clean: 3 delivered, 0 returned");
  });

  it("renders interactive button badge when onClick is provided", async () => {
    const handleClick = vi.fn();
    render(<DeliveryRecordBadge record={record} onClick={handleClick} />);

    const button = screen.getByRole("button");
    expect(button).toBeDefined();
    expect(button.getAttribute("title")).toBe(
      "Clean: 3 delivered, 0 returned — click to view history"
    );

    await userEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("stops click event propagation to avoid triggering parent handlers", async () => {
    const handleClick = vi.fn();
    const handleParentClick = vi.fn();

    render(
      <div onClick={handleParentClick}>
        <DeliveryRecordBadge record={record} onClick={handleClick} />
      </div>
    );

    const button = screen.getByRole("button");
    await userEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleParentClick).not.toHaveBeenCalled();
  });
});
