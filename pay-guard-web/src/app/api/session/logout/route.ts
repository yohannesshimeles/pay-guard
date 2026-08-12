import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicBackendUrl } from "@/lib/api/server";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("pg_refresh")?.value;
  if (refreshToken) {
    await fetch(publicBackendUrl("/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  const response = NextResponse.json({
    success: true,
    message: "Signed out",
    data: { loggedOut: true },
    correlationId: "web-gateway",
  });
  response.cookies.delete("pg_access");
  response.cookies.delete("pg_refresh");
  response.cookies.delete("pg_role");
  return response;
}
