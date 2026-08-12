import { apiClient } from "./client";

export function phaseTwoRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return apiClient<T>(`/api/backend${path}`, init);
}
