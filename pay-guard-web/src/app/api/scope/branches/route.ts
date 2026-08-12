import { NextResponse } from "next/server";
import { z } from "zod";
import { backendRequest } from "@/lib/api/server";
import { routeError } from "@/lib/api/route-error";

export async function GET(request: Request) {
  const businessId = new URL(request.url).searchParams.get("businessId");
  if (!z.string().uuid().safeParse(businessId).success) {
    return NextResponse.json(
      {
        success: false,
        message: "A valid business context is required",
        data: null,
        error: { code: "INVALID_BUSINESS_CONTEXT" },
        correlationId: "web-gateway",
      },
      { status: 400 },
    );
  }
  try {
    const branches = await backendRequest<
      Array<{ id: string; name: string; status: string }>
    >(`/businesses/${businessId}/branches`);
    return NextResponse.json({
      success: true,
      message: "Branches loaded",
      data: branches,
      correlationId: "web-gateway",
    });
  } catch (error) {
    return routeError(error);
  }
}
