import { NextResponse } from "next/server";
import { z } from "zod";
import { readEnvelope, type TokenPair } from "@/lib/api/contracts";
import { publicBackendUrl } from "@/lib/api/server";

const loginSchema = z.object({
  identity: z.string().min(3).max(254),
  password: z.string().min(8),
});

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Validation failed",
        data: null,
        error: { code: "INVALID_LOGIN", details: parsed.error.issues.map((issue) => issue.message) },
        correlationId: "web-gateway",
      },
      { status: 400 },
    );
  }

  const backendResponse = await fetch(publicBackendUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...parsed.data, devicePlatform: "web" }),
    cache: "no-store",
  });
  if (!backendResponse.ok) {
    return new NextResponse(await backendResponse.text(), {
      status: backendResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokens = await readEnvelope<TokenPair>(backendResponse);
  if (!tokens.principal) {
    return NextResponse.json(
      {
        success: false,
        message: "Login response did not include a principal",
        data: null,
        error: { code: "INVALID_LOGIN_RESPONSE" },
        correlationId: "web-gateway",
      },
      { status: 502 },
    );
  }

  const response = NextResponse.json({
    success: true,
    message: "Signed in successfully",
    data: { principal: tokens.principal },
    correlationId: "web-gateway",
  });
  response.cookies.set(
    "pg_access",
    tokens.accessToken,
    cookieOptions(tokens.accessTokenExpiresIn),
  );
  response.cookies.set(
    "pg_refresh",
    tokens.refreshToken,
    cookieOptions(tokens.refreshTokenExpiresIn),
  );
  response.cookies.set(
    "pg_role",
    tokens.principal.role,
    cookieOptions(tokens.refreshTokenExpiresIn),
  );
  return response;
}
