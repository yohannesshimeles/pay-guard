import { describe, expect, it } from "vitest";
import { readEnvelope } from "./contracts";

describe("readEnvelope", () => {
  it("returns successful response data", async () => {
    const response = new Response(
      JSON.stringify({
        success: true,
        message: "ok",
        data: { status: "ready" },
        correlationId: "corr-1",
      }),
      { status: 200 },
    );
    await expect(readEnvelope(response)).resolves.toEqual({ status: "ready" });
  });

  it("preserves safe API error context", async () => {
    const response = new Response(
      JSON.stringify({
        success: false,
        message: "Access denied",
        data: null,
        error: { code: "FORBIDDEN" },
        correlationId: "corr-2",
      }),
      { status: 403 },
    );
    await expect(readEnvelope(response)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      correlationId: "corr-2",
    });
  });
});
