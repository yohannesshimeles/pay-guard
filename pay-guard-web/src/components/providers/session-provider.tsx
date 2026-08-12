"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { apiClient } from "@/lib/api/client";
import { ApiError, type Principal } from "@/lib/api/contracts";

type SessionContextValue = {
  principal?: Principal;
  loading: boolean;
  error?: ApiError;
  refresh: () => Promise<unknown>;
  clear: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function getSession() {
  try {
    return await apiClient<Principal>("/api/session/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await apiClient<{ refreshed: boolean }>("/api/session/refresh", {
        method: "POST",
      });
      return apiClient<Principal>("/api/session/me");
    }
    throw error;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    retry: false,
    staleTime: 60_000,
  });

  return (
    <SessionContext.Provider
      value={{
        principal: session.data,
        loading: session.isLoading,
        error: session.error instanceof ApiError ? session.error : undefined,
        refresh: session.refetch,
        clear: () => {
          queryClient.setQueryData(["session"], undefined);
          queryClient.removeQueries({ queryKey: ["scoped"] });
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within SessionProvider");
  return context;
}
