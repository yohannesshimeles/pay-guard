import { ApiError, readEnvelope } from "./contracts";

export async function apiClient<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "PayGuard is currently unreachable. Check your connection and try again.",
      0,
      "NETWORK_UNAVAILABLE",
    );
  }
  return readEnvelope<T>(response);
}
