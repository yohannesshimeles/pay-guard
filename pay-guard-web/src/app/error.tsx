"use client";

import { FeedbackState } from "@/components/ui/feedback-state";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <FeedbackState state="error" onRetry={reset} />
    </main>
  );
}
