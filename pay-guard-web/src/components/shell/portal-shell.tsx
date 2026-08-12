"use client";

import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { ScopeProvider } from "@/components/providers/scope-provider";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { FeedbackState } from "@/components/ui/feedback-state";
import { apiClient } from "@/lib/api/client";
import type { WebRole } from "@/lib/api/contracts";
import { cn } from "@/lib/cn";
import { roleHome, roleLabel } from "@/lib/auth/roles";
import { roleNavigation } from "./navigation";
import { ScopeSwitcher } from "./scope-switcher";

function Navigation({
  role,
  onNavigate,
}: {
  role: WebRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={`${roleLabel(role)} navigation`} className="grid gap-1 px-3">
      {roleNavigation[role].map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href ||
          (item.href !== roleHome[role] && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold text-slate-300 transition hover:bg-white/8 hover:text-white",
              active && "bg-brand-500 text-white shadow-sm",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden className="size-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalShell({
  role,
  children,
}: {
  role: WebRole;
  children: React.ReactNode;
}) {
  const session = useSession();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!session.loading && (!session.principal || session.error)) {
      router.replace("/session-expired");
    }
  }, [router, session.error, session.loading, session.principal]);

  if (session.loading) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <FeedbackState state="loading" />
      </main>
    );
  }
  if (!session.principal || session.principal.role !== role) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <FeedbackState state="permission" />
      </main>
    );
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiClient<{ loggedOut: boolean }>("/api/session/logout", {
        method: "POST",
      });
    } finally {
      session.clear();
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <ScopeProvider principal={session.principal}>
      <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-68 flex-col bg-ink-950 text-white lg:flex">
          <div className="flex h-20 items-center border-b border-white/10 px-5">
            <Logo inverse />
          </div>
          <div className="flex-1 overflow-y-auto py-5">
            <p className="px-6 pb-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
              {roleLabel(role)}
            </p>
            <Navigation role={role} />
          </div>
          <div className="border-t border-white/10 p-4">
            <Button
              variant="ghost"
              fullWidth
              loading={loggingOut}
              onClick={logout}
              className="justify-start text-slate-300 hover:bg-white/8 hover:text-white"
            >
              <LogOut aria-hidden className="size-4" />
              Sign out
            </Button>
          </div>
        </aside>

        <Drawer open={menuOpen} title="PayGuard menu" onClose={() => setMenuOpen(false)}>
          <div className="py-4">
            <Navigation role={role} onNavigate={() => setMenuOpen(false)} />
          </div>
        </Drawer>

        <div className="min-w-0 lg:col-start-2">
          <header className="sticky top-0 z-20 border-b border-line bg-canvas/92 backdrop-blur-xl">
            <div className="flex min-h-20 items-center gap-3 px-4 sm:px-6 xl:px-8">
              <Button
                variant="secondary"
                size="sm"
                className="lg:hidden"
                onClick={() => setMenuOpen(true)}
                aria-label="Open navigation"
              >
                <Menu aria-hidden className="size-5" />
              </Button>
              <div className="hidden lg:block">
                <ScopeSwitcher />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" aria-label="Search">
                  <Search aria-hidden className="size-5" />
                </Button>
                <Button variant="ghost" size="sm" aria-label="Notifications" className="relative">
                  <Bell aria-hidden className="size-5" />
                  <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger-700 ring-2 ring-canvas" />
                </Button>
                <button className="flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-white" aria-label="Open profile menu">
                  <span className="grid size-8 place-items-center rounded-xl bg-brand-700 text-xs font-extrabold text-white">
                    {roleLabel(role)
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-xs font-extrabold text-ink-900">
                      {roleLabel(role)}
                    </span>
                    <span className="block text-[11px] text-ink-500">Active session</span>
                  </span>
                  <ChevronDown aria-hidden className="hidden size-4 text-ink-500 sm:block" />
                </button>
              </div>
            </div>
            <div className="border-t border-line px-4 py-2 lg:hidden">
              <ScopeSwitcher />
            </div>
          </header>
          <main className="p-4 sm:p-6 xl:p-8">{children}</main>
        </div>
      </div>
    </ScopeProvider>
  );
}
