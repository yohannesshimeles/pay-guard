"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldShell, Input } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { phaseTwoRequest } from "@/lib/api/phase-two-client";
import type { Business } from "@/lib/api/phase-two-contracts";

const schema = z.object({
  name: z.string().trim().min(2),
  registrationNumber: z.string().trim().optional(),
  ownerEmail: z.email(),
  ownerPhone: z.string().trim().optional(),
  password: z.string().min(12),
});

export function BusinessRegistration() {
  const [validation, setValidation] = useState<string>();
  const registration = useMutation({
    mutationFn: (input: z.infer<typeof schema>) =>
      phaseTwoRequest<Business>("/businesses/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation(undefined);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    registration.mutate(parsed.data);
  }

  if (registration.data) {
    return (
      <div className="text-center">
        <StatusBadge status="pending">PENDING REVIEW</StatusBadge>
        <h1 className="mt-5 font-display text-3xl font-extrabold">Application received</h1>
        <p className="mt-3 text-sm leading-6 text-ink-500">
          {registration.data.name} was registered. A platform administrator must activate it before branch setup begins.
        </p>
        <Link className="mt-7 inline-block font-bold text-brand-700" href="/login">Return to sign in</Link>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <FieldShell label="Business name" htmlFor="registration-name"><Input id="registration-name" name="name" required /></FieldShell>
      <FieldShell label="Registration number" htmlFor="registration-number" optional><Input id="registration-number" name="registrationNumber" /></FieldShell>
      <FieldShell label="Owner email" htmlFor="registration-email"><Input id="registration-email" name="ownerEmail" type="email" required /></FieldShell>
      <FieldShell label="Owner phone" htmlFor="registration-phone" optional><Input id="registration-phone" name="ownerPhone" /></FieldShell>
      <FieldShell label="Password" htmlFor="registration-password" hint="Use at least 12 characters."><Input id="registration-password" name="password" type="password" minLength={12} required autoComplete="new-password" /></FieldShell>
      {validation || registration.error ? <p role="alert" className="rounded-xl bg-danger-100 p-3 text-sm text-danger-700">{validation ?? registration.error?.message}</p> : null}
      <Button type="submit" loading={registration.isPending}>Submit application</Button>
      <Link className="text-center text-sm font-bold text-brand-700" href="/login">Already registered? Sign in</Link>
    </form>
  );
}
