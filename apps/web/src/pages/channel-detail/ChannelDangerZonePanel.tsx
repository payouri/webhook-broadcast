import { useEffect, useRef, useState } from "react";
import { Trash2, TriangleAlert, X } from "lucide-react";
import type { Channel } from "@webhook-broadcast/contract";
import { SectionTitle } from "../../components/SectionTitle.js";
import { api, describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";

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
  const deletingLabel = useDelayedPending(deleting);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnClose = useRef(false);

  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [channel.id]);

  // Overlay focus contract (DESIGN.md #4): the confirm region replaces the
  // Delete Channel button rather than opening a modal, so focus has to be
  // moved onto it deliberately or a keyboard/screen reader user is stranded
  // on <body> once the button they pressed is gone. Cancelling is the
  // reverse trip: focus returns to the Delete Channel button that opened the
  // region (issue #61), not wherever the browser defaults to once the
  // confirm region it was sitting on unmounts.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
      return;
    }
    if (restoreFocusOnClose.current) {
      restoreFocusOnClose.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  function cancelDelete(): void {
    restoreFocusOnClose.current = true;
    setConfirming(false);
    setError(null);
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteChannel(channel.id);
      onDeleted();
    } catch (err) {
      setError(describeApiError(err, "Failed to delete Channel"));
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
        <div
          className="confirm-region"
          role="group"
          aria-label={`Confirm delete Channel ${channel.slug}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              cancelDelete();
            }
          }}
        >
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
              ref={confirmRef}
              type="button"
              className="control control-commit"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              {deletingLabel ? "Deleting…" : "Confirm delete"}
            </button>
            <button type="button" className="control" onClick={cancelDelete} disabled={deleting}>
              <X size={13} strokeWidth={2} aria-hidden="true" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="inline-form">
          <button
            ref={triggerRef}
            type="button"
            className="control"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
            Delete Channel
          </button>
        </div>
      )}
    </section>
  );
}
