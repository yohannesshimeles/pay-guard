import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type FieldShellProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
};

export function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: FieldShellProps) {
  const detailId = `${htmlFor}-detail`;
  return (
    <div className="grid gap-2">
      <label className="flex items-center justify-between text-sm font-bold text-ink-900" htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="text-xs font-medium text-ink-500">Optional</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={detailId} className="flex items-center gap-1.5 text-sm text-danger-700" role="alert">
          <AlertCircle aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={detailId} className="text-xs leading-5 text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "min-h-12 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink-950 shadow-sm transition placeholder:text-ink-500 hover:border-ink-500 focus:border-brand-600 focus:ring-4 focus:ring-brand-100",
        invalid && "border-danger-700 focus:border-danger-700 focus:ring-danger-100",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink-900 shadow-sm transition focus:border-brand-600 focus:ring-4 focus:ring-brand-100",
      invalid && "border-danger-700",
      className,
    )}
    aria-invalid={invalid || undefined}
    {...props}
  />
));

Select.displayName = "Select";

export const CurrencyInput = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <span className="pointer-events-none absolute top-3.5 left-3 text-sm font-extrabold text-ink-500">
        ETB
      </span>
      <Input
        ref={ref}
        inputMode="decimal"
        className={cn("pl-12 text-right tabular-nums", className)}
        {...props}
      />
    </div>
  ),
);

CurrencyInput.displayName = "CurrencyInput";

export const DateTimeInput = forwardRef<HTMLInputElement, InputProps>(
  (props, ref) => <Input ref={ref} type="datetime-local" {...props} />,
);

DateTimeInput.displayName = "DateTimeInput";
