import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Info,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";

const statusStyle = {
  success: {
    icon: CheckCircle2,
    className: "bg-success-100 text-success-700",
  },
  pending: {
    icon: Clock3,
    className: "bg-warning-100 text-warning-700",
  },
  danger: {
    icon: XCircle,
    className: "bg-danger-100 text-danger-700",
  },
  warning: {
    icon: AlertTriangle,
    className: "bg-warning-100 text-warning-700",
  },
  neutral: {
    icon: Info,
    className: "bg-slate-100 text-ink-700",
  },
} as const;

export function StatusBadge({
  status,
  children,
}: {
  status: keyof typeof statusStyle;
  children: React.ReactNode;
}) {
  const definition = statusStyle[status];
  const Icon = definition.icon;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold",
        definition.className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}
