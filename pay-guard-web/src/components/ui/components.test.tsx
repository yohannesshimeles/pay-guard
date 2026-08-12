import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { DataTable } from "./data-table";
import { FeedbackState } from "./feedback-state";
import { StatusBadge } from "./status-badge";

describe("foundation components", () => {
  it("supports keyboard activation", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("communicates status in text, not color alone", () => {
    render(<StatusBadge status="success">Approved</StatusBadge>);
    expect(screen.getByText("Approved")).toBeVisible();
  });

  it("exposes a retry action for errors", async () => {
    const onRetry = vi.fn();
    render(<FeedbackState state="error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders an accessible table caption", () => {
    render(
      <DataTable
        caption="Accounts"
        columns={[{ key: "name", header: "Name", cell: (row) => row.name }]}
        rows={[{ id: "1", name: "Primary" }]}
        getRowKey={(row) => row.id}
      />,
    );
    expect(screen.getByRole("table", { name: "Accounts" })).toBeVisible();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = render(
      <main>
        <h1>Operations</h1>
        <StatusBadge status="pending">Pending review</StatusBadge>
        <Button>Review</Button>
      </main>,
    );
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
