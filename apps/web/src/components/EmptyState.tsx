import type { ReactNode } from "react";

/**
 * An empty state teaches the next action in the domain's own words ("Send a
 * request to POST /ingest/<slug> with a Channel token"), never "Nothing here."
 * One muted glyph, and no illustration: PRODUCT.md rules out the friendly
 * empty-state mascot as consumer-SaaS bleed, and this is an instrument.
 *
 * The copy is wrapped in one element on purpose. Left as bare children of a
 * column-flex parent, every text node and every inline `<code>` became its own
 * flex item, so a one-sentence instruction stacked into three centered
 * fragments with the endpoint on a line of its own.
 */
export function EmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="empty-state-copy">{children}</span>
    </p>
  );
}
