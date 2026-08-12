import { BadgeCheck, LockKeyhole, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(24rem,1fr)_minmax(32rem,1.15fr)]">
      <section className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-32 -left-24 size-96 rounded-full bg-brand-500/20 blur-3xl" />
        <Logo inverse />
        <div className="relative my-auto max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-bold text-cyan-100">
            <ShieldCheck aria-hidden className="size-4" />
            Enterprise payment operations
          </span>
          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.08] tracking-tight">
            Every payment.
            <br />
            Accounted for.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            A secure, role-aware workspace for managing verification,
            settlement, reconciliation, and branch operations.
          </p>
          <div className="mt-10 grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <LockKeyhole aria-hidden className="size-5 shrink-0 text-cyan-300" />
              <span>Tokens remain protected in secure HTTP-only cookies.</span>
            </div>
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <BadgeCheck aria-hidden className="size-5 shrink-0 text-cyan-300" />
              <span>Access is constrained by role, business, and branch.</span>
            </div>
          </div>
        </div>
        <p className="relative text-xs text-slate-500">
          PayGuard secure operations console
        </p>
      </section>
      <section className="grid place-items-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-700">
            Welcome back
          </p>
          <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink-950">
            Sign in to PayGuard
          </h2>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            Use the account assigned by your platform or business administrator.
          </p>
          <div className="mt-8">
            <LoginForm />
          </div>
          <p className="mt-5 text-center text-sm text-ink-500">
            New business?{" "}
            <Link className="font-bold text-brand-700" href="/register-business">
              Submit an application
            </Link>
          </p>
          <p className="mt-8 text-center text-xs leading-5 text-ink-500">
            Access is monitored and recorded. Do not share your credentials.
          </p>
        </div>
      </section>
    </main>
  );
}
