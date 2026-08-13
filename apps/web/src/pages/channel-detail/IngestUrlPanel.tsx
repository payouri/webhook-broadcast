import type { Channel } from "@webhook-broadcast/contract";
import { CopyButton } from "../../components/CopyButton.js";
import { ingestUrl } from "../../lib/ingestUrl.js";

/**
 * Permanent, tab-independent display of the Channel's ingest URL (issue #47).
 * Previously this string appeared exactly once — the Activity tab's empty
 * state — and vanished for good the moment the first Broadcast arrived,
 * forcing anyone setting up a new integration back to the README. It now
 * lives on the Channel itself, next to the tab strip, so it is on screen no
 * matter which tab is open.
 *
 * A Channel with `allowUnauthenticatedIngest` set is called out right here,
 * not only in Settings: once that flag is on, this URL is the *only* thing
 * gating the Channel's fan-out, so anyone reading the URL needs to know that
 * in the same glance.
 */
export function IngestUrlPanel({ channel }: { channel: Channel }) {
  const url = ingestUrl(channel.slug);

  return (
    <section className="card stack">
      <h2>Ingest URL</h2>
      <div className="copy-row">
        <code>{url}</code>
        <CopyButton value={url} />
      </div>
      {channel.allowUnauthenticatedIngest && (
        <p className="muted" id="unauthenticated-ingest-note">
          Unauthenticated ingest is enabled for this Channel. This URL alone is accepted, no bearer
          token required.
        </p>
      )}
    </section>
  );
}
