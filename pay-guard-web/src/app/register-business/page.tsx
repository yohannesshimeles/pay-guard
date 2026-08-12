import { Logo } from "@/components/brand/logo";
import { BusinessRegistration } from "@/components/phase-two/business-registration";

export default function RegisterBusinessPage() {
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <section className="w-full max-w-xl rounded-3xl border border-line bg-white p-6 shadow-panel sm:p-9">
        <Logo />
        <p className="mt-9 text-xs font-extrabold uppercase tracking-[0.18em] text-brand-700">Business onboarding</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Register for PayGuard</h1>
        <p className="mt-2 mb-7 text-sm leading-6 text-ink-500">Create the owner account and submit the business for platform review.</p>
        <BusinessRegistration />
      </section>
    </main>
  );
}
