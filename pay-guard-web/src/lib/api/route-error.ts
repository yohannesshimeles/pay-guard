import { NextResponse } from "next/server";
import { ApiError } from "./contracts";

export function routeError(error: unknown) {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError("An unexpected gateway error occurred", 500);
  return NextResponse.json(
    {
      success: false,
      message: apiError.message,
      data: null,
      error: {
        code: apiError.code,
        details: apiError.details,
      },
      correlationId: apiError.correlationId ?? "web-gateway",
    },
    { status: apiError.status || 500 },
  );
}
