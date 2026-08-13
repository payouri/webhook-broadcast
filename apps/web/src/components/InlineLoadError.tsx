import { RotateCcw, TriangleAlert } from "lucide-react";

/** Inline fetch error with a manual retry (ADR 0004 empty/loading/error). */
export function InlineLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="error-text" role="alert">
      <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
      {message}
      <button type="button" className="control" onClick={() => void onRetry()}>
        <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
        Retry
      </button>
    </p>
  );
}
