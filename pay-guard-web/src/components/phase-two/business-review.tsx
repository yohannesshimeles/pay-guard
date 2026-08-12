"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Select } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Business, BusinessStatus } from "@/lib/api/phase-two-contracts";
import { phaseTwoRequest } from "@/lib/api/phase-two-client";

const tones: Record<BusinessStatus, "success" | "pending" | "warning" | "danger"> = {
  ACTIVE: "success",
  PENDING: "pending",
  SUSPENDED: "warning",
  REJECTED: "danger",
};

export function BusinessReview() {
  const queryClient = useQueryClient();
  const [nextStatus, setNextStatus] = useState<Record<string, BusinessStatus>>({});
  const businesses = useQuery({
    queryKey: ["scoped", "businesses", "platform"],
    queryFn: () => phaseTwoRequest<Business[]>("/businesses"),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BusinessStatus }) =>
      phaseTwoRequest<Business>(`/businesses/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          reason: status === "ACTIVE" ? undefined : "Platform review decision",
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["scoped", "businesses"] }),
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-700">
          Platform management
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Business applications</h1>
        <p className="mt-2 text-sm text-ink-500">
          Review registrations and control platform access. Every decision is audited.
        </p>
      </div>
      <Panel>
        <PanelHeader title="Registered businesses" description="Newest applications appear first." />
        {businesses.isLoading ? <div className="p-5"><FeedbackState state="loading" compact /></div> : null}
        {businesses.isError ? <div className="p-5"><FeedbackState state="error" compact onRetry={() => businesses.refetch()} /></div> : null}
        {businesses.data?.length === 0 ? <div className="p-5"><FeedbackState state="empty" compact /></div> : null}
        <div className="divide-y divide-line">
          {businesses.data?.map((business) => (
            <article key={business.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                  <Building2 aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-ink-950">{business.name}</h2>
                    <StatusBadge status={tones[business.status]}>{business.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-ink-500">
                    {business.contactEmail ?? "No contact email"} · Registration{" "}
                    {business.registrationNumber ?? "not supplied"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Select
                  aria-label={`Status for ${business.name}`}
                  value={nextStatus[business.id] ?? business.status}
                  onChange={(event) =>
                    setNextStatus((current) => ({
                      ...current,
                      [business.id]: event.target.value as BusinessStatus,
                    }))
                  }
                >
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
                <Button
                  variant="secondary"
                  loading={update.isPending && update.variables?.id === business.id}
                  onClick={() =>
                    update.mutate({
                      id: business.id,
                      status: nextStatus[business.id] ?? business.status,
                    })
                  }
                >
                  Apply
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
