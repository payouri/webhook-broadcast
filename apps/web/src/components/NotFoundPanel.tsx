import { useEffect } from "react";
import { Link } from "react-router";

/**
 * Inline "this address has no view" panel with a way back to the directory
 * (issue #42). Used both for an unknown Channel id and for a URL that matches
 * no route at all — a shared or bookmarked link that has gone stale should say
 * so in place, not dump the operator somewhere else without explanation.
 */
export function NotFoundPanel({ message, title }: { message: string; title: string }) {
  useEffect(() => {
    document.title = `${title} · webhook-broadcast`;
  }, [title]);

  return (
    <div className="stack">
      <p className="muted empty-state" role="alert">
        {message}
      </p>
      <Link to="/" className="button-ghost">
        ← Back to Channels
      </Link>
    </div>
  );
}
