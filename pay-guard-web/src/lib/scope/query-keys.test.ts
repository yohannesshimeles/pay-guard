import { describe, expect, it } from "vitest";
import { scopedQueryKey } from "./query-keys";

describe("scopedQueryKey", () => {
  it("separates cached data by business and branch", () => {
    expect(scopedQueryKey("transactions", "business-a", "branch-a")).not.toEqual(
      scopedQueryKey("transactions", "business-b", "branch-a"),
    );
  });

  it("uses explicit values for absent scope", () => {
    expect(scopedQueryKey("transactions")).toEqual([
      "scoped",
      "transactions",
      "none",
      "none",
    ]);
  });
});
