import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-extrabold text-brand-700">404</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-ink-950">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-ink-500">
          The requested PayGuard page does not exist.
        </p>
        <Link className="mt-6 inline-block font-bold text-brand-700" href="/">
          Return to dashboard
        </Link>
      </div>
    </main>
  );
}
