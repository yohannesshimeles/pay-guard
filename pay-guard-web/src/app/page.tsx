import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { roles, type WebRole } from "@/lib/api/contracts";
import { getHomeForRole } from "@/lib/auth/roles";

export default async function HomePage() {
  const role = (await cookies()).get("pg_role")?.value;
  if (roles.includes(role as WebRole)) {
    redirect(getHomeForRole(role as WebRole));
  }
  redirect("/login");
}
