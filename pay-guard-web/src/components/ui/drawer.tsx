"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Drawer({
  open,
  title,
  children,
  onClose,
  side = "left",
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  side?: "left" | "right";
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink-950/45" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute inset-y-0 w-[min(88vw,21rem)] bg-ink-950 text-white shadow-panel",
          side === "left" ? "left-0" : "right-0",
        )}
      >
        <header className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <strong className="font-display">{title}</strong>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close menu" className="text-white hover:bg-white/10 hover:text-white">
            <X aria-hidden className="size-5" />
          </Button>
        </header>
        {children}
      </section>
      <button
        className={cn(
          "absolute inset-y-0 cursor-default",
          side === "left" ? "right-0 left-[min(88vw,21rem)]" : "right-[min(88vw,21rem)] left-0",
        )}
        aria-label="Close menu"
        onClick={onClose}
      />
    </div>
  );
}
