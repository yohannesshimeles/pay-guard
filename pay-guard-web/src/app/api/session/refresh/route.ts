import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readEnvelope, type TokenPair } from "@/lib/api/contracts";
import { publicBackendUrl } from "@/lib/api/server";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("pg_refresh")?.value;
  if (!refreshToken) {
    return NextResponse.json(
      {
        success: false,
        message: "Your session has expired",
        data: null,
        error: { code: "SESSION_EXPIRED" },
        correlationId: "web-gateway",
      },
      { status: 401 },
    );
  }
  const backendResponse = await fetch(publicBackendUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  if (!backendResponse.ok) {
    const response = new NextResponse(await backendResponse.text(), {
      status: backendResponse.status,
      headers: { "Content-Type": "application/json" },
    });
    response.cookies.delete("pg_access");
    response.cookies.delete("pg_refresh");
    response.cookies.delete("pg_role");
    return response;
  }
  const tokens = await readEnvelope<TokenPair>(backendResponse);
  const response = NextResponse.json({
    success: true,
    message: "Session refreshed",
    data: { refreshed: true },
    correlationId: "web-gateway",
  });
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  response.cookies.set("pg_access", tokens.accessToken, {
    ...common,
    maxAge: tokens.accessTokenExpiresIn,
  });
  response.cookies.set("pg_refresh", tokens.refreshToken, {
    ...common,
    maxAge: tokens.refreshTokenExpiresIn,
  });
  return response;
}
