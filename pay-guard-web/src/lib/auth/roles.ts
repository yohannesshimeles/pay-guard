import type { WebRole } from "@/lib/api/contracts";

export const roleHome: Record<WebRole, string> = {
  PLATFORM_SUPER_ADMIN: "/platform",
  BUSINESS_OWNER: "/owner",
  MANAGER: "/manager",
  CASHIER: "/cashier",
};

export function getHomeForRole(role: WebRole) {
  return roleHome[role];
}

export function roleLabel(role: WebRole) {
  return {
    PLATFORM_SUPER_ADMIN: "Platform Super Admin",
    BUSINESS_OWNER: "Business Owner",
    MANAGER: "Manager",
    CASHIER: "Cashier",
  }[role];
}
