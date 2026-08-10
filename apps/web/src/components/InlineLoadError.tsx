/** Inline fetch error with a manual retry (ADR 0004 empty/loading/error). */
export function InlineLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="error-text error-with-retry" role="alert">
      {message}{" "}
      <button type="button" className="button-ghost" onClick={() => void onRetry()}>
        Retry
      </button>
    </p>
  );
}
