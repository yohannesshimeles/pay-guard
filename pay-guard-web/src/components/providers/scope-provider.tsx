"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiClient } from "@/lib/api/client";
import type { Principal } from "@/lib/api/contracts";

type ScopeOption = { id: string; name: string; status: string };

type ScopeContextValue = {
  businesses: ScopeOption[];
  branches: ScopeOption[];
  businessId?: string;
  branchId?: string;
  fixedBranch: boolean;
  loading: boolean;
  setBusinessId: (id: string) => void;
  setBranchId: (id: string) => void;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({
  principal,
  children,
}: {
  principal: Principal;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const isOwner = principal.role === "BUSINESS_OWNER";
  const [businessId, setBusinessIdState] = useState<string | undefined>(
    principal.businessIds[0],
  );
  const [branchId, setBranchIdState] = useState<string | undefined>(
    principal.branchId,
  );

  const businesses = useQuery({
    queryKey: ["scope", "businesses"],
    queryFn: () => apiClient<ScopeOption[]>("/api/scope/businesses"),
    enabled: isOwner,
  });
  const branches = useQuery({
    queryKey: ["scope", "branches", businessId],
    queryFn: () =>
      apiClient<ScopeOption[]>(
        `/api/scope/branches?businessId=${encodeURIComponent(businessId ?? "")}`,
      ),
    enabled: isOwner && Boolean(businessId),
  });

  useEffect(() => {
    if (isOwner && branches.data?.length && !branchId) {
      setBranchIdState(branches.data[0].id);
    }
  }, [branchId, branches.data, isOwner]);

  const value = useMemo<ScopeContextValue>(
    () => ({
      businesses:
        businesses.data ??
        principal.businessIds.map((id) => ({
          id,
          name: `Business ${id.slice(0, 8)}`,
          status: "ACTIVE",
        })),
      branches:
        branches.data ??
        (principal.branchId
          ? [{ id: principal.branchId, name: "Assigned branch", status: "ACTIVE" }]
          : []),
      businessId,
      branchId,
      fixedBranch: !isOwner,
      loading: businesses.isLoading || branches.isLoading,
      setBusinessId: (id) => {
        setBusinessIdState(id);
        setBranchIdState(undefined);
        void queryClient.invalidateQueries({ queryKey: ["scoped"] });
      },
      setBranchId: (id) => {
        setBranchIdState(id);
        void queryClient.invalidateQueries({ queryKey: ["scoped"] });
      },
    }),
    [
      branchId,
      branches.data,
      branches.isLoading,
      businessId,
      businesses.data,
      businesses.isLoading,
      isOwner,
      principal.branchId,
      principal.businessIds,
      queryClient,
    ],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const context = useContext(ScopeContext);
  if (!context) throw new Error("useScope must be used within ScopeProvider");
  return context;
}
