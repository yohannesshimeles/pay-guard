import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

export function Logo({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={cn("grid size-9 place-items-center rounded-xl", inverse ? "bg-white text-brand-700" : "bg-brand-700 text-white")}>
        <ShieldCheck aria-hidden className="size-5" strokeWidth={2.4} />
      </span>
      {!compact ? (
        <span className={cn("font-display text-lg font-extrabold tracking-tight", inverse ? "text-white" : "text-ink-950")}>
          PayGuard
        </span>
      ) : null}
    </span>
  );
}
