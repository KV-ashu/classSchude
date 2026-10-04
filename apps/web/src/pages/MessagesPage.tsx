import { EmptyStateCard } from '../components/EmptyStateCard';

export function MessagesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Messages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every message ingested through a MessageSourceAdapter, with its pipeline status history.
        </p>
      </header>

      <EmptyStateCard title="No messages yet" phase="Phase 4">
        The manual input and demo simulator adapters land in Phase 4. Duplicate messages are
        discarded via content hashing before any processing happens.
      </EmptyStateCard>
    </div>
  );
}
