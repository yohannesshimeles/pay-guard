import { NextResponse } from "next/server";
import { backendRequest } from "@/lib/api/server";
import { routeError } from "@/lib/api/route-error";

export async function GET() {
  try {
    const businesses = await backendRequest<
      Array<{ id: string; name: string; status: string }>
    >("/businesses");
    return NextResponse.json({
      success: true,
      message: "Businesses loaded",
      data: businesses,
      correlationId: "web-gateway",
    });
  } catch (error) {
    return routeError(error);
  }
}
