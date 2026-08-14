import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft, SearchX } from "lucide-react";

/**
 * Inline "this address has no view" panel with a way back to the directory
 * (issue #42). Used both for an unknown Channel id and for a URL that matches
 * no route at all — a shared or bookmarked link that has gone stale should say
 * so in place, not dump the operator somewhere else without explanation.
 *
 * Issue #57: a broken address is a failure, not an empty list, so this renders
 * DESIGN.md's inline Lamp Cut error treatment (`.error-text`, `role="alert"`)
 * rather than the dashed `.empty-state` well an earlier version of this panel
 * borrowed — that treatment stays reserved for a genuinely empty list
 * (`EmptyState`), a different fact from an unresolvable route.
 *
 * Two deliberate deviations from DESIGN.md §Loading, empty, and error, both
 * because the glyph vocabulary and the terminal nature of this state outrank
 * the generic error shape:
 *
 * - The glyph is `SearchX`, DESIGN.md's assigned "not found" glyph, not the
 *   `TriangleAlert` that section names for a failure. Glyphs there are
 *   semantic, never decorative, and this panel's fact *is* not-found; the
 *   Lamp Cut color and inline placement are what separate it from the empty
 *   state, so keeping the glyph honest costs that separation nothing.
 * - There is no Retry control beside the message. Nothing here is retryable:
 *   the address itself can never resolve, so the offer back to the directory
 *   (`Back to Channels`) is the only next action that exists.
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
      <p className="error-text" role="alert">
        <SearchX size={14} strokeWidth={2} aria-hidden="true" />
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
