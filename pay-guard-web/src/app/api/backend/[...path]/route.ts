import { NextResponse } from "next/server";
import { backendRequest } from "@/lib/api/server";
import { isAllowedPhaseTwoPath } from "@/lib/api/gateway-path";
import { routeError } from "@/lib/api/route-error";

async function proxy(request: Request, segments: string[]) {
  const path = segments.join("/");
  if (!isAllowedPhaseTwoPath(path)) {
    return NextResponse.json(
      {
        success: false,
        message: "Unsupported web gateway path",
        data: null,
        error: { code: "UNSUPPORTED_GATEWAY_PATH" },
        correlationId: "web-gateway",
      },
      { status: 404 },
    );
  }
  try {
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text();
    const data = await backendRequest<unknown>(
      `/${path}${new URL(request.url).search}`,
      { method: request.method, body: body || undefined },
    );
    return NextResponse.json({
      success: true,
      message: "Request completed successfully",
      data,
      correlationId: "web-gateway",
    });
  } catch (error) {
    return routeError(error);
  }
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function POST(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function PATCH(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
