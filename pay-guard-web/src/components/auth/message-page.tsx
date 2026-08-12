import Link from "next/link";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export function MessagePage({
  kind,
}: {
  kind: "access-denied" | "session-expired";
}) {
  const expired = kind === "session-expired";
  const Icon = expired ? LockKeyhole : ShieldAlert;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-lg rounded-3xl border border-line bg-white p-7 text-center shadow-panel sm:p-10">
        <div className="flex justify-center"><Logo /></div>
        <span className="mx-auto mt-10 grid size-14 place-items-center rounded-2xl bg-danger-100 text-danger-700">
          <Icon aria-hidden className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-extrabold text-ink-950">
          {expired ? "Your session has ended" : "Access denied"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-500">
          {expired
            ? "For your security, sign in again to continue using PayGuard."
            : "Your assigned role cannot open this workspace. Return to your own dashboard or contact an administrator."}
        </p>
        <Link
          href={expired ? "/login" : "/"}
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-600"
        >
          {expired ? "Return to sign in" : "Go to my dashboard"}
        </Link>
      </section>
    </main>
  );
}
