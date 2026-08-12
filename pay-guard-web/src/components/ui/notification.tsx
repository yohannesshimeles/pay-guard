import { Bell, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function NotificationBanner({
  title,
  children,
  tone = "info",
  onDismiss,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "info" | "warning" | "danger";
  onDismiss?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4",
        tone === "info" && "border-brand-500/30 bg-brand-100/50",
        tone === "warning" && "border-amber-300 bg-warning-100",
        tone === "danger" && "border-red-300 bg-danger-100",
      )}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Bell aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-700" />
      <div className="min-w-0 flex-1">
        <strong className="text-sm text-ink-950">{title}</strong>
        <div className="mt-1 text-sm leading-6 text-ink-700">{children}</div>
      </div>
      {onDismiss ? (
        <Button variant="ghost" size="sm" aria-label="Dismiss notification" onClick={onDismiss}>
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
    </aside>
  );
}
