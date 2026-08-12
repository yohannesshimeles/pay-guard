import { describe, expect, it } from "vitest";
import { isAllowedPhaseTwoPath } from "./gateway-path";

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const resourceId = "33333333-3333-4333-8333-333333333333";

describe("Phase 2 gateway allowlist", () => {
  it.each([
    "businesses",
    "businesses/register",
    `businesses/${businessId}/status`,
    `businesses/${businessId}/branches`,
    `businesses/${businessId}/branches/${branchId}`,
    `businesses/${businessId}/branches/${branchId}/users`,
    `businesses/${businessId}/branches/${branchId}/users/${resourceId}/remove`,
    `businesses/${businessId}/branches/${branchId}/settlement-accounts`,
    `businesses/${businessId}/branches/${branchId}/settlement-accounts/${resourceId}/deactivate`,
    "banks",
  ])("allows %s", (path) => expect(isAllowedPhaseTwoPath(path)).toBe(true));

  it.each([
    "http://attacker.test",
    "../auth/me",
    "auth/login",
    "businesses/not-a-uuid/status",
    `businesses/${businessId}/branches/${branchId}/unknown`,
  ])("rejects %s", (path) => expect(isAllowedPhaseTwoPath(path)).toBe(false));
});
