import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft, SearchX } from "lucide-react";

/**
 * "This address has no view" panel with a way back to the directory (issue
 * #42). Used both for an unknown Channel id and for a URL that matches no
 * route at all — a shared or bookmarked link that has gone stale should say
 * so in place, not dump the operator somewhere else without explanation.
 *
 * On a plate, like every other screen (the 2026-08-14 critique): this used to
 * be the one view that rendered directly on the page ground, which read as an
 * unstyled error dump rather than a screen the system had actually drawn.
 *
 * Issue #57 put this message in DESIGN.md's inline Lamp Cut error treatment
 * (`.error-text`, `role="alert"`), reasoning that "a broken address is a
 * failure, not an empty list." That confused *why* the view is empty (a
 * genuine load failure, which is retryable and does belong in Lamp Cut) with
 * the fact *that* it is empty, which this is: nothing failed, the address
 * simply never named a view, and Lamp Cut and `role="alert"` both promise a
 * fault an operator can act on. Neither is true here, so the message instead
 * takes `.advisory` — a recessed well with an info glyph in Ink, the same
 * idiom Settings uses to state a consequence — nested inside the plate per
 * The Inward Depth Rule (plates never nest; nested content becomes a well).
 *
 * The glyph stays `SearchX`, DESIGN.md's assigned "not found" glyph rather
 * than `.advisory`'s usual `Info`: it is semantic, not decorative, and this
 * panel's fact *is* not-found. There is still no Retry control beside the
 * message — nothing here is retryable, so the offer back to the directory
 * (`Back to Channels`) is the only next action that exists.
 */
export function NotFoundPanel({ message, title }: { message: string; title: string }) {
  useEffect(() => {
    document.title = `${title} · webhook-broadcast`;
  }, [title]);

  return (
    <div className="plate stack">
      {/* This view's one h1: used both for the catch-all route and for an
          unknown Channel id, so either way this is the view's heading. */}
      <h1 className="notfound-title">{title}</h1>
      <p className="advisory">
        <SearchX className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
        <span>{message}</span>
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
