import {
  AlertTriangle,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

const definitions = {
  loading: {
    icon: LoaderCircle,
    title: "Loading secure data",
    detail: "Please wait while PayGuard retrieves the latest information.",
  },
  empty: {
    icon: Inbox,
    title: "Nothing here yet",
    detail: "Records will appear here when activity begins.",
  },
  error: {
    icon: AlertTriangle,
    title: "We could not load this view",
    detail: "Try again. If the issue continues, share the correlation ID with support.",
  },
  offline: {
    icon: WifiOff,
    title: "You appear to be offline",
    detail: "Reconnect to continue. No unconfirmed changes were recorded.",
  },
  permission: {
    icon: LockKeyhole,
    title: "Access restricted",
    detail: "Your role or current business scope does not allow this action.",
  },
} as const;

export function FeedbackState({
  state,
  onRetry,
  compact = false,
}: {
  state: keyof typeof definitions;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const definition = definitions[state];
  const Icon = definition.icon;
  return (
    <section
      className={cn(
        "grid place-items-center rounded-2xl border border-dashed border-line bg-white text-center",
        compact ? "p-5" : "min-h-64 p-8",
      )}
      aria-live={state === "loading" ? "polite" : undefined}
    >
      <div className="grid max-w-sm justify-items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-700">
          <Icon
            aria-hidden
            className={cn("size-6", state === "loading" && "animate-spin")}
          />
        </span>
        <div>
          <h2 className="font-display text-base font-extrabold text-ink-950">
            {definition.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-500">
            {definition.detail}
          </p>
        </div>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </section>
  );
}
