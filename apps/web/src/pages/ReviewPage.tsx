import { CONFIDENCE_THRESHOLDS } from '@classsync/shared';
import { EmptyStateCard } from '../components/EmptyStateCard';

const REVIEW_LOWER = CONFIDENCE_THRESHOLDS.REVIEW.toFixed(2);
const REVIEW_UPPER = (CONFIDENCE_THRESHOLDS.AUTO_APPLY - 0.01).toFixed(2);

export function ReviewPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Review queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Changes scored between {REVIEW_LOWER} and {REVIEW_UPPER} wait here for your correction
          and approval. The AI never auto-applies ambiguous messages.
        </p>
      </header>

      <EmptyStateCard title="No pending changes" phase="Phase 6 + 8">
        When a message like &quot;I think DBMS is cancelled&quot; is extracted, the proposed change
        lands here with the raw message side by side so you can approve, edit, or reject it.
      </EmptyStateCard>
    </div>
  );
}
