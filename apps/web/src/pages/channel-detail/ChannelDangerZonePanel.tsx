import { useEffect, useState } from "react";
import { Trash2, TriangleAlert, X } from "lucide-react";
import type { Channel } from "@webhook-broadcast/contract";
import { SectionTitle } from "../../components/SectionTitle.js";
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
    <section className="plate stack">
      {/* The one legend in the system that carries a warning glyph rather than a
          domain one: this section is defined by its consequence. It is still not
          a lamp color, because a heading is not a status. */}
      <SectionTitle icon={<TriangleAlert size={13} strokeWidth={2} />}>Delete Channel</SectionTitle>
      <p className="prose">
        Deleting removes this Channel from the directory and from normal use. Its Broadcasts and
        Deliveries are retained until pruned. Disabling a Channel is a separate, reversible setting.
      </p>

      {confirming ? (
        <div className="confirm-region">
          <p>
            Delete <strong>{channel.slug}</strong>? Endpoints on this Channel stop receiving
            Broadcasts.
          </p>
          {error && (
            <p className="error-text" role="alert">
              <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
              {error}
            </p>
          )}
          <div className="inline-form">
            {/* Outlined, not filled: a destructive commit is visually distinct
                from a routine one at the moment it fires. */}
            <button
              type="button"
              className="control control-commit"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              {deleting ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="control"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={deleting}
            >
              <X size={13} strokeWidth={2} aria-hidden="true" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="inline-form">
          <button type="button" className="control" onClick={() => setConfirming(true)}>
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
            Delete Channel
          </button>
        </div>
      )}
    </section>
  );
}
