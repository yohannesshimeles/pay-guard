"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldShell, Input } from "@/components/ui/field";
import { apiClient } from "@/lib/api/client";
import { ApiError, type Principal } from "@/lib/api/contracts";
import { getHomeForRole } from "@/lib/auth/roles";

const schema = z.object({
  identity: z.string().trim().min(3, "Enter your email or username."),
  password: z.string().min(8, "Password must contain at least 8 characters."),
});

type LoginValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { identity: "", password: "" },
  });

  async function submit(values: LoginValues) {
    setServerError(undefined);
    try {
      const result = await apiClient<{ principal: Principal }>(
        "/api/session/login",
        { method: "POST", body: JSON.stringify(values) },
      );
      queryClient.setQueryData(["session"], result.principal);
      router.replace(getHomeForRole(result.principal.role));
      router.refresh();
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Sign in is temporarily unavailable. Please try again.",
      );
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit(submit)} noValidate>
      <FieldShell
        label="Email or username"
        htmlFor="identity"
        error={errors.identity?.message}
      >
        <div className="relative">
          <Mail
            aria-hidden
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-ink-500"
          />
          <Input
            id="identity"
            autoComplete="username"
            autoFocus
            className="pl-10"
            aria-invalid={Boolean(errors.identity)}
            {...register("identity")}
          />
        </div>
      </FieldShell>
      <FieldShell
        label="Password"
        htmlFor="password"
        error={errors.password?.message}
      >
        <div className="relative">
          <LockKeyhole
            aria-hidden
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-ink-500"
          />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="px-10"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          <button
            type="button"
            className="absolute top-1 right-1 grid size-10 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>
        </div>
      </FieldShell>
      {serverError ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-danger-100 px-4 py-3 text-sm font-semibold text-danger-700"
        >
          {serverError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2 text-ink-700">
          <input type="checkbox" className="size-4 accent-brand-700" />
          Remember this device
        </label>
        <span className="font-bold text-brand-700">Contact your administrator</span>
      </div>
      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        Sign in securely
      </Button>
    </form>
  );
}
