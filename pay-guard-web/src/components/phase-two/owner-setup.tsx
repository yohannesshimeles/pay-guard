"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, UserPlus, Users, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FeedbackState } from "@/components/ui/feedback-state";
import { FieldShell, Input, Select } from "@/components/ui/field";
import { NotificationBanner } from "@/components/ui/notification";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api/contracts";
import { phaseTwoRequest } from "@/lib/api/phase-two-client";
import type {
  Bank,
  Branch,
  SettlementAccount,
  StaffMember,
  StaffRole,
} from "@/lib/api/phase-two-contracts";

const branchSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().optional(),
  address: z.string().trim().optional(),
});
const staffSchema = z.object({
  email: z.email(),
  phone: z.string().trim().optional(),
  role: z.enum(["MANAGER", "CASHIER", "WAITER"]),
  temporaryPassword: z.string().min(12),
});
const accountSchema = z.object({
  bankId: z.string().uuid(),
  accountValue: z.string().trim().min(4),
  label: z.string().trim().optional(),
});

function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : "The request could not be completed.";
  return <p role="alert" className="rounded-xl bg-danger-100 p-3 text-sm font-semibold text-danger-700">{message}</p>;
}

export function OwnerSetup() {
  const scope = useScope();
  const queryClient = useQueryClient();
  const businessId = scope.businessId;
  const branchId = scope.branchId;
  const [section, setSection] = useState<"branches" | "staff" | "accounts">("branches");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StaffMember>();
  const [removeReason, setRemoveReason] = useState("");

  const branches = useQuery({
    queryKey: ["scoped", "branches", businessId],
    queryFn: () => phaseTwoRequest<Branch[]>(`/businesses/${businessId}/branches`),
    enabled: Boolean(businessId),
  });
  const staff = useQuery({
    queryKey: ["scoped", "staff", businessId, branchId, includeRemoved],
    queryFn: () =>
      phaseTwoRequest<StaffMember[]>(
        `/businesses/${businessId}/branches/${branchId}/users?includeRemoved=${includeRemoved}`,
      ),
    enabled: Boolean(businessId && branchId),
  });
  const accounts = useQuery({
    queryKey: ["scoped", "settlement-accounts", businessId, branchId],
    queryFn: () =>
      phaseTwoRequest<SettlementAccount[]>(
        `/businesses/${businessId}/branches/${branchId}/settlement-accounts`,
      ),
    enabled: Boolean(businessId && branchId),
  });
  const banks = useQuery({
    queryKey: ["banks", "enabled"],
    queryFn: () => phaseTwoRequest<Bank[]>("/banks"),
  });

  const createBranch = useMutation({
    mutationFn: (input: z.infer<typeof branchSchema>) =>
      phaseTwoRequest<Branch>(`/businesses/${businessId}/branches`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["scoped", "branches", businessId] }),
  });
  const createStaff = useMutation({
    mutationFn: (input: z.infer<typeof staffSchema>) =>
      phaseTwoRequest<StaffMember>(
        `/businesses/${businessId}/branches/${branchId}/users`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["scoped", "staff", businessId, branchId] }),
  });
  const updateBranch = useMutation({
    mutationFn: (input: {
      name?: string;
      address?: string;
      verificationTimeToleranceMinutes?: number;
    }) =>
      phaseTwoRequest<Branch>(
        `/businesses/${businessId}/branches/${branchId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["scoped", "branches", businessId],
      }),
  });
  const removeStaff = useMutation({
    mutationFn: () =>
      phaseTwoRequest(
        `/businesses/${businessId}/branches/${branchId}/users/${removeTarget?.id}/remove`,
        { method: "POST", body: JSON.stringify({ reason: removeReason }) },
      ),
    onSuccess: async () => {
      setRemoveTarget(undefined);
      setRemoveReason("");
      await queryClient.invalidateQueries({ queryKey: ["scoped", "staff", businessId, branchId] });
    },
  });
  const createAccount = useMutation({
    mutationFn: (input: z.infer<typeof accountSchema>) =>
      phaseTwoRequest<SettlementAccount>(
        `/businesses/${businessId}/branches/${branchId}/settlement-accounts`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["scoped", "settlement-accounts", businessId, branchId],
      }),
  });
  const deactivateAccount = useMutation({
    mutationFn: (id: string) =>
      phaseTwoRequest(
        `/businesses/${businessId}/branches/${branchId}/settlement-accounts/${id}/deactivate`,
        { method: "POST" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["scoped", "settlement-accounts", businessId, branchId],
      }),
  });

  function formValues(event: FormEvent<HTMLFormElement>) {
    return Object.fromEntries(new FormData(event.currentTarget).entries());
  }

  if (!businessId) {
    return <FeedbackState state="empty" />;
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-700">Business configuration</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Branch setup</h1>
        <p className="mt-2 text-sm text-ink-500">Configure the explicitly selected business and branch shown above.</p>
      </div>
      <NotificationBanner title="Scope protection active">
        Staff and settlement account requests always include the currently selected business and branch.
      </NotificationBanner>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Setup sections">
        {(["branches", "staff", "accounts"] as const).map((item) => (
          <Button
            key={item}
            role="tab"
            aria-selected={section === item}
            variant={section === item ? "primary" : "secondary"}
            onClick={() => setSection(item)}
          >
            {item === "branches" ? <Building2 aria-hidden className="size-4" /> : null}
            {item === "staff" ? <Users aria-hidden className="size-4" /> : null}
            {item === "accounts" ? <Landmark aria-hidden className="size-4" /> : null}
            {item[0].toUpperCase() + item.slice(1)}
          </Button>
        ))}
      </div>

      {section === "branches" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Panel>
            <PanelHeader title="Branches" description="Branches linked to the selected business." />
            {branches.isLoading ? <div className="p-5"><FeedbackState state="loading" compact /></div> : null}
            <div className="divide-y divide-line">
              {branches.data?.map((branch) => (
                <article key={branch.id} className="flex items-start justify-between gap-4 p-5">
                  <div>
                    <strong>{branch.name}</strong>
                    <p className="mt-1 text-sm text-ink-500">{branch.address || "No address supplied"} · {branch.settings.timezone}</p>
                  </div>
                  <StatusBadge status={branch.status === "ACTIVE" ? "success" : "neutral"}>{branch.status}</StatusBadge>
                </article>
              ))}
              {branches.data?.length === 0 ? <div className="p-5"><FeedbackState state="empty" compact /></div> : null}
            </div>
          </Panel>
          <Panel className="h-fit p-5">
            <h2 className="font-display text-lg font-extrabold">Add branch</h2>
            <form
              className="mt-5 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const parsed = branchSchema.safeParse(formValues(event));
                if (parsed.success) createBranch.mutate(parsed.data, { onSuccess: () => form.reset() });
              }}
            >
              <FieldShell label="Branch name" htmlFor="branch-name"><Input id="branch-name" name="name" required minLength={2} /></FieldShell>
              <FieldShell label="Branch code" htmlFor="branch-code" optional><Input id="branch-code" name="code" /></FieldShell>
              <FieldShell label="Address" htmlFor="branch-address" optional><Input id="branch-address" name="address" /></FieldShell>
              <MutationError error={createBranch.error} />
              <Button type="submit" loading={createBranch.isPending}>Create branch</Button>
            </form>
            {branchId ? (
              <>
                <hr className="my-6 border-line" />
                <h2 className="font-display text-lg font-extrabold">Update selected branch</h2>
                <form
                  className="mt-5 grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = formValues(event);
                    updateBranch.mutate({
                      name: String(values.name || "") || undefined,
                      address: String(values.address || "") || undefined,
                      verificationTimeToleranceMinutes: values.tolerance
                        ? Number(values.tolerance)
                        : undefined,
                    });
                  }}
                >
                  <FieldShell label="New name" htmlFor="branch-update-name" optional><Input id="branch-update-name" name="name" minLength={2} /></FieldShell>
                  <FieldShell label="New address" htmlFor="branch-update-address" optional><Input id="branch-update-address" name="address" /></FieldShell>
                  <FieldShell label="Verification tolerance (minutes)" htmlFor="branch-tolerance" optional><Input id="branch-tolerance" name="tolerance" type="number" min={0} max={1440} /></FieldShell>
                  <MutationError error={updateBranch.error} />
                  <Button type="submit" variant="secondary" loading={updateBranch.isPending}>Update selected branch</Button>
                </form>
              </>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {section === "staff" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Panel>
            <PanelHeader
              title="Branch staff"
              description="Removed staff remain in audit history but leave the active list."
              action={
                <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                  <input
                    type="checkbox"
                    checked={includeRemoved}
                    onChange={(event) => setIncludeRemoved(event.target.checked)}
                  />
                  Include removed
                </label>
              }
            />
            {!branchId ? <div className="p-5"><FeedbackState state="empty" compact /></div> : null}
            <div className="divide-y divide-line">
              {staff.data?.map((member) => (
                <article key={member.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <strong>{member.email ?? member.phone}</strong>
                    <div className="mt-2 flex gap-2"><StatusBadge status="success">{member.status}</StatusBadge><StatusBadge status="neutral">{member.role}</StatusBadge></div>
                  </div>
                  {member.status !== "REMOVED" ? <Button variant="danger" size="sm" onClick={() => setRemoveTarget(member)}>
                    <XCircle aria-hidden className="size-4" /> Remove
                  </Button> : null}
                </article>
              ))}
            </div>
          </Panel>
          <Panel className="h-fit p-5">
            <h2 className="flex items-center gap-2 font-display text-lg font-extrabold"><UserPlus aria-hidden className="size-5" /> Add staff</h2>
            <form
              className="mt-5 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const parsed = staffSchema.safeParse(formValues(event));
                if (parsed.success) createStaff.mutate(parsed.data, { onSuccess: () => form.reset() });
              }}
            >
              <FieldShell label="Email" htmlFor="staff-email"><Input id="staff-email" name="email" type="email" required /></FieldShell>
              <FieldShell label="Phone" htmlFor="staff-phone" optional><Input id="staff-phone" name="phone" /></FieldShell>
              <FieldShell label="Role" htmlFor="staff-role"><Select id="staff-role" name="role" defaultValue={"CASHIER" satisfies StaffRole}><option value="MANAGER">Manager</option><option value="CASHIER">Cashier</option><option value="WAITER">Waiter</option></Select></FieldShell>
              <FieldShell label="Temporary password" htmlFor="staff-password" hint="At least 12 characters; send it through a secure channel."><Input id="staff-password" name="temporaryPassword" type="password" required minLength={12} autoComplete="new-password" /></FieldShell>
              <MutationError error={createStaff.error} />
              <Button type="submit" loading={createStaff.isPending} disabled={!branchId}>Create staff account</Button>
            </form>
          </Panel>
        </div>
      ) : null}

      {section === "accounts" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Panel>
            <PanelHeader title="Settlement accounts" description="Account values are encrypted by the backend and always masked here." />
            <div className="divide-y divide-line">
              {accounts.data?.map((account) => (
                <article key={account.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div><strong>{account.bank.name}</strong><p className="mt-1 font-mono text-sm text-ink-500">{account.accountMask}</p><p className="mt-1 text-xs text-ink-500">{account.label || "Branch receiving account"}</p></div>
                  <div className="flex items-center gap-2"><StatusBadge status={account.active ? "success" : "neutral"}>{account.active ? "Active" : "Inactive"}</StatusBadge>{account.active ? <Button variant="danger" size="sm" onClick={() => deactivateAccount.mutate(account.id)}>Deactivate</Button> : null}</div>
                </article>
              ))}
            </div>
          </Panel>
          <Panel className="h-fit p-5">
            <h2 className="font-display text-lg font-extrabold">Add receiving account</h2>
            <form
              className="mt-5 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const parsed = accountSchema.safeParse(formValues(event));
                if (parsed.success) createAccount.mutate(parsed.data, { onSuccess: () => form.reset() });
              }}
            >
              <FieldShell label="Bank" htmlFor="account-bank"><Select id="account-bank" name="bankId" required defaultValue=""><option value="" disabled>Select enabled bank</option>{banks.data?.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</Select></FieldShell>
              <FieldShell label="Account number or wallet" htmlFor="account-value" hint="The full value is sent once and never returned to the browser."><Input id="account-value" name="accountValue" required minLength={4} autoComplete="off" /></FieldShell>
              <FieldShell label="Label" htmlFor="account-label" optional><Input id="account-label" name="label" /></FieldShell>
              <MutationError error={createAccount.error} />
              <Button type="submit" loading={createAccount.isPending} disabled={!branchId}>Add account</Button>
            </form>
          </Panel>
        </div>
      ) : null}

      <Dialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.email ?? "staff member"}?`}
        description="Access, active sessions and registered devices will be revoked immediately. Financial and audit history will be preserved."
        onClose={() => setRemoveTarget(undefined)}
      >
        <div className="grid gap-4">
          <FieldShell label="Removal reason" htmlFor="removal-reason" hint="Required for the audit record.">
            <Input id="removal-reason" value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} minLength={5} />
          </FieldShell>
          <MutationError error={removeStaff.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button>
            <Button variant="danger" disabled={removeReason.trim().length < 5} loading={removeStaff.isPending} onClick={() => removeStaff.mutate()}>Confirm removal</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
