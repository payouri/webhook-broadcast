import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft, SearchX } from "lucide-react";

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
      {/* This view's one h1: used both for the catch-all route and for an
          unknown Channel id, so either way this is the view's heading. */}
      <h1 className="notfound-title">{title}</h1>
      <p className="empty-state" role="alert">
        <span className="empty-state-icon" aria-hidden="true">
          <SearchX size={20} strokeWidth={1.5} />
        </span>
        {message}
      </p>
      <div className="back-bar">
        <Link to="/" className="control">
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Back to Channels
        </Link>
      </div>
    </div>
  );
}
