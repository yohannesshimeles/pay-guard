import { cookies } from "next/headers";
import { ApiError, readEnvelope } from "./contracts";

const apiBaseUrl =
  process.env.PAYGUARD_API_URL ?? "http://127.0.0.1:4000/api/v1";

export async function backendRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get("pg_access")?.value;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  return readEnvelope<T>(response);
}

export function publicBackendUrl(path: string) {
  if (!path.startsWith("/")) {
    throw new ApiError("Invalid backend path", 500, "INVALID_BACKEND_PATH");
  }
  return `${apiBaseUrl}${path}`;
}
