import { describe, expect, it } from "vitest";
import { getHomeForRole, roleLabel } from "./roles";

describe("role routing", () => {
  it.each([
    ["PLATFORM_SUPER_ADMIN", "/platform"],
    ["BUSINESS_OWNER", "/owner"],
    ["MANAGER", "/manager"],
    ["CASHIER", "/cashier"],
  ] as const)("maps %s to its isolated landing page", (role, expected) => {
    expect(getHomeForRole(role)).toBe(expected);
    expect(roleLabel(role)).toBeTruthy();
  });
});
