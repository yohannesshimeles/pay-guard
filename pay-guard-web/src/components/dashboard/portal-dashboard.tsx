import {
  Activity,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock3,
  Landmark,
  ShieldCheck,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { NotificationBanner } from "@/components/ui/notification";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WebRole } from "@/lib/api/contracts";
import { roleLabel } from "@/lib/auth/roles";

type DashboardConfig = {
  eyebrow: string;
  heading: string;
  description: string;
  action: string;
  metrics: Array<{
    label: string;
    value: string;
    detail: string;
    icon: LucideIcon;
  }>;
};

const dashboard: Record<WebRole, DashboardConfig> = {
  PLATFORM_SUPER_ADMIN: {
    eyebrow: "Platform command centre",
    heading: "Platform overview",
    description:
      "Monitor onboarding, service health, and risk controls across PayGuard.",
    action: "Review businesses",
    metrics: [
      { label: "Platform state", value: "Operational", detail: "Foundation services ready", icon: Activity },
      { label: "Review queue", value: "—", detail: "Connect onboarding API in Phase 2", icon: Building2 },
      { label: "Risk alerts", value: "—", detail: "No live feed connected", icon: ShieldCheck },
      { label: "Platform users", value: "—", detail: "Identity module pending", icon: Users },
    ],
  },
  BUSINESS_OWNER: {
    eyebrow: "Business workspace",
    heading: "Business overview",
    description:
      "See branch readiness, settlement configuration, and operational status.",
    action: "Manage businesses",
    metrics: [
      { label: "Current scope", value: "Selected", detail: "Use the selectors above", icon: Building2 },
      { label: "Settlement", value: "—", detail: "Connect account data in Phase 2", icon: Landmark },
      { label: "Transactions", value: "—", detail: "No live activity loaded", icon: WalletCards },
      { label: "Team access", value: "Protected", detail: "Role and scope enforced", icon: Users },
    ],
  },
  MANAGER: {
    eyebrow: "Branch operations",
    heading: "Manager overview",
    description:
      "Review branch verification, deposit, and reconciliation readiness.",
    action: "Open review queue",
    metrics: [
      { label: "Branch scope", value: "Fixed", detail: "Assigned by an owner", icon: Building2 },
      { label: "Pending review", value: "—", detail: "Connect review API in Phase 2", icon: Clock3 },
      { label: "Reconciliation", value: "—", detail: "No live period loaded", icon: CheckCircle2 },
      { label: "Controls", value: "Active", detail: "Manager permissions applied", icon: ShieldCheck },
    ],
  },
  CASHIER: {
    eyebrow: "Frontline operations",
    heading: "Cashier overview",
    description:
      "Run payment verification and cash operations in your assigned branch.",
    action: "Start verification",
    metrics: [
      { label: "Branch scope", value: "Fixed", detail: "Assigned by a manager", icon: Building2 },
      { label: "Verification", value: "Ready", detail: "Awaiting a payment reference", icon: ShieldCheck },
      { label: "Cash activity", value: "—", detail: "No live shift loaded", icon: WalletCards },
      { label: "Reconciliation", value: "—", detail: "No open period loaded", icon: CheckCircle2 },
    ],
  },
};

type FoundationRow = {
  id: string;
  capability: string;
  protection: string;
  status: "Ready" | "Planned";
};

const rows: FoundationRow[] = [
  {
    id: "session",
    capability: "Secure session gateway",
    protection: "HTTP-only access and refresh cookies",
    status: "Ready",
  },
  {
    id: "role",
    capability: "Role-aware navigation",
    protection: "Direct-route denial and role landing",
    status: "Ready",
  },
  {
    id: "scope",
    capability: "Business and branch scope",
    protection: "Scoped cache invalidation",
    status: "Ready",
  },
  {
    id: "data",
    capability: "Live operational modules",
    protection: "Typed API contracts and validation",
    status: "Planned",
  },
];

const columns: Column<FoundationRow>[] = [
  {
    key: "capability",
    header: "Capability",
    cell: (row) => <strong className="text-ink-950">{row.capability}</strong>,
  },
  { key: "protection", header: "Protection", cell: (row) => row.protection },
  {
    key: "status",
    header: "Status",
    cell: (row) => (
      <StatusBadge status={row.status === "Ready" ? "success" : "pending"}>
        {row.status}
      </StatusBadge>
    ),
  },
];

export function PortalDashboard({ role }: { role: WebRole }) {
  const config = dashboard[role];
  return (
    <div className="mx-auto grid max-w-[100rem] gap-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-700">
            {config.eyebrow}
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink-950 sm:text-4xl">
            {config.heading}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-500">
            {config.description}
          </p>
        </div>
        <Button>
          {config.action}
          <ArrowUpRight aria-hidden className="size-4" />
        </Button>
      </div>

      <NotificationBanner title="Phase 1 foundation is active">
        This view intentionally shows readiness states instead of invented
        financial figures. Live module data will be connected in the next
        implementation phase.
      </NotificationBanner>

      <section aria-label={`${roleLabel(role)} summary`} className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {config.metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Panel key={metric.label} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-500">
                    {metric.label}
                  </p>
                  <p className="mt-3 font-display text-2xl font-extrabold text-ink-950">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-ink-500">{metric.detail}</p>
                </div>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                  <Icon aria-hidden className="size-5" />
                </span>
              </div>
            </Panel>
          );
        })}
      </section>

      <Panel>
        <PanelHeader
          title="Foundation readiness"
          description="Security and UX capabilities delivered in this phase."
          action={<StatusBadge status="success">Phase 1</StatusBadge>}
        />
        <DataTable
          caption="Phase 1 foundation readiness"
          rows={rows}
          columns={columns}
          getRowKey={(row) => row.id}
        />
      </Panel>
    </div>
  );
}
