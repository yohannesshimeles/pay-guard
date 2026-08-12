import { FeedbackState } from "@/components/ui/feedback-state";

export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <FeedbackState state="loading" />
    </main>
  );
}
