"use client";

import { FileUp, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "./button";

export function FileUpload({
  label = "Upload document",
  accept = ".jpg,.jpeg,.png,.pdf",
  maxSizeMb = 10,
  onChange,
}: {
  label?: string;
  accept?: string;
  maxSizeMb?: number;
  onChange?: (file?: File) => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();

  function select(next?: File) {
    if (next && next.size > maxSizeMb * 1024 * 1024) {
      setError(`File must be ${maxSizeMb} MB or smaller.`);
      return;
    }
    setError(undefined);
    setFile(next);
    onChange?.(next);
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor={id}
        className="grid min-h-36 cursor-pointer place-items-center rounded-2xl border border-dashed border-brand-500 bg-brand-100/30 p-5 text-center transition hover:bg-brand-100/60"
      >
        <span className="grid justify-items-center gap-2">
          <FileUp aria-hidden className="size-6 text-brand-700" />
          <strong className="text-sm text-ink-900">{label}</strong>
          <span className="text-xs text-ink-500">
            JPG, JPEG, PNG or PDF · up to {maxSizeMb} MB
          </span>
        </span>
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => select(event.target.files?.[0])}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {file ? (
        <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-sm">
          <span className="truncate font-semibold text-ink-700">{file.name}</span>
          <Button variant="ghost" size="sm" onClick={() => select(undefined)} aria-label={`Remove ${file.name}`}>
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
