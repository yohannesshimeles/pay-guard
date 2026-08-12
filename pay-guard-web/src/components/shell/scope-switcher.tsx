"use client";

import { Building2, MapPin } from "lucide-react";
import { useScope } from "@/components/providers/scope-provider";
import { Select } from "@/components/ui/field";

export function ScopeSwitcher() {
  const scope = useScope();
  if (scope.fixedBranch) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
        <MapPin aria-hidden className="size-4 shrink-0 text-brand-700" />
        <span className="truncate text-xs font-bold text-ink-700">
          {scope.branches[0]?.name ?? "Assigned branch"}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-ink-500">
          Fixed
        </span>
      </div>
    );
  }

  return (
    <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
      <label className="relative min-w-44">
        <span className="sr-only">Current business</span>
        <Building2 aria-hidden className="pointer-events-none absolute top-3.5 left-3 size-4 text-brand-700" />
        <Select
          className="pl-9"
          value={scope.businessId ?? ""}
          onChange={(event) => scope.setBusinessId(event.target.value)}
          disabled={scope.loading || !scope.businesses.length}
        >
          <option value="" disabled>
            Select business
          </option>
          {scope.businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="relative min-w-44">
        <span className="sr-only">Current branch</span>
        <MapPin aria-hidden className="pointer-events-none absolute top-3.5 left-3 size-4 text-brand-700" />
        <Select
          className="pl-9"
          value={scope.branchId ?? ""}
          onChange={(event) => scope.setBranchId(event.target.value)}
          disabled={scope.loading || !scope.branches.length}
        >
          <option value="" disabled>
            Select branch
          </option>
          {scope.branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
