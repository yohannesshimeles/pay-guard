import { NextResponse } from "next/server";
import type { Principal } from "@/lib/api/contracts";
import { backendRequest } from "@/lib/api/server";
import { routeError } from "@/lib/api/route-error";

export async function GET() {
  try {
    const principal = await backendRequest<Principal>("/auth/me");
    return NextResponse.json({
      success: true,
      message: "Session is active",
      data: principal,
      correlationId: "web-gateway",
    });
  } catch (error) {
    return routeError(error);
  }
}
