import { NextResponse, type NextRequest } from "next/server";
import { getHomeForRole } from "@/lib/auth/roles";
import type { WebRole } from "@/lib/api/contracts";

const routeRoles: Array<[string, WebRole]> = [
  ["/platform", "PLATFORM_SUPER_ADMIN"],
  ["/owner", "BUSINESS_OWNER"],
  ["/manager", "MANAGER"],
  ["/cashier", "CASHIER"],
];

export function middleware(request: NextRequest) {
  const role = request.cookies.get("pg_role")?.value as WebRole | undefined;
  const protectedRoute = routeRoles.find(([prefix]) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (protectedRoute) {
    if (!role) {
      const url = new URL("/login", request.url);
      url.searchParams.set("reason", "session-required");
      return NextResponse.redirect(url);
    }
    if (protectedRoute[1] !== role) {
      return NextResponse.redirect(new URL("/access-denied", request.url));
    }
  }

  if (request.nextUrl.pathname === "/login" && role) {
    return NextResponse.redirect(new URL(getHomeForRole(role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/platform/:path*",
    "/owner/:path*",
    "/manager/:path*",
    "/cashier/:path*",
  ],
};
