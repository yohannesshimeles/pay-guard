import { CheckCircle2, Circle } from "lucide-react";

export type TimelineItem = {
  id: string;
  title: string;
  detail?: string;
  time?: string;
  complete?: boolean;
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="grid gap-0">
      {items.map((item, index) => (
        <li key={item.id} className="grid grid-cols-[1.5rem_1fr] gap-3">
          <div className="grid grid-rows-[1.5rem_1fr] justify-items-center">
            {item.complete ? (
              <CheckCircle2 aria-hidden className="size-5 text-success-700" />
            ) : (
              <Circle aria-hidden className="size-5 text-ink-500" />
            )}
            {index < items.length - 1 ? (
              <span className="my-1 w-px bg-line" aria-hidden />
            ) : null}
          </div>
          <div className="pb-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-sm text-ink-900">{item.title}</strong>
              {item.time ? <time className="text-xs text-ink-500">{item.time}</time> : null}
            </div>
            {item.detail ? (
              <p className="mt-1 text-sm leading-6 text-ink-500">{item.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
