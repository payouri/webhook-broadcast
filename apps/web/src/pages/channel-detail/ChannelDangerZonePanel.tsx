import { useEffect, useState } from "react";
import type { Channel } from "@webhook-broadcast/contract";
import { api } from "../../lib/api.js";

/**
 * Settings tab soft-delete (epic US4): removes the Channel from normal use while its Broadcasts and
 * Deliveries are retained until pruned. Distinct from the `enabled` toggle, which stays in Settings.
 */
export function ChannelDangerZonePanel({
  channel,
  onDeleted,
}: {
  channel: Channel;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [channel.id]);

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteChannel(channel.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete Channel");
      setDeleting(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Delete Channel</h2>
      <p className="muted">
        Deleting removes this Channel from the directory and from normal use. Its Broadcasts and
        Deliveries are retained until pruned. Disabling a Channel is a separate, reversible setting.
      </p>

      {confirming ? (
        <div className="confirm-region stack">
          <p>
            Delete <strong>{channel.slug}</strong>? Endpoints on this Channel stop receiving
            Broadcasts.
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="inline-form">
            <button type="button" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="inline-form">
          <button type="button" className="button-ghost" onClick={() => setConfirming(true)}>
            Delete Channel
          </button>
        </div>
      )}
    </section>
  );
}
