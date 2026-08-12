import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/api/contracts";
import { ScopeProvider, useScope } from "./scope-provider";

vi.mock("@/lib/api/client", () => ({
  apiClient: vi.fn().mockResolvedValue([]),
}));

function ScopeProbe() {
  const scope = useScope();
  return (
    <>
      <span>{scope.fixedBranch ? "fixed" : "switchable"}</span>
      <button onClick={() => scope.setBusinessId("business-b")}>Switch business</button>
    </>
  );
}

function renderScope(principal: Principal) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ScopeProvider principal={principal}>
        <ScopeProbe />
      </ScopeProvider>
    </QueryClientProvider>,
  );
  return invalidate;
}

describe("ScopeProvider", () => {
  it("invalidates scoped server data when an owner changes business", async () => {
    const invalidate = renderScope({
      userId: "owner",
      role: "BUSINESS_OWNER",
      businessIds: ["business-a", "business-b"],
    });
    expect(screen.getByText("switchable")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Switch business" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["scoped"] });
  });

  it("keeps manager scope fixed to the assigned branch", () => {
    renderScope({
      userId: "manager",
      role: "MANAGER",
      businessIds: ["business-a"],
      branchId: "branch-a",
    });
    expect(screen.getByText("fixed")).toBeVisible();
  });
});
