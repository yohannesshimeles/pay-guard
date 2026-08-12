import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/api/contracts";
import { LoginForm } from "./login-form";

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ apiClient: mocks.apiClient }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

describe("LoginForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces a stale anonymous session before entering the role portal", async () => {
    const principal: Principal = {
      userId: "admin",
      role: "PLATFORM_SUPER_ADMIN",
      businessIds: [],
    };
    mocks.apiClient.mockResolvedValue({ principal });
    const queryClient = new QueryClient();
    queryClient.setQueryData(["session"], undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <LoginForm />
      </QueryClientProvider>,
    );
    await userEvent.type(
      screen.getByLabelText("Email or username"),
      "admin@example.test",
    );
    await userEvent.type(screen.getByLabelText("Password"), "private-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in securely" }));

    await waitFor(() => {
      expect(queryClient.getQueryData(["session"])).toEqual(principal);
      expect(mocks.replace).toHaveBeenCalledWith("/platform");
    });
  });
});
