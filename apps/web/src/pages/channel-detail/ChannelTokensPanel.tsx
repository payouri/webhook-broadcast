import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, KeyRound, Plus, ShieldOff, X } from "lucide-react";
import type { Channel, ChannelTokenCreated } from "@webhook-broadcast/contract";
import { CopyButton } from "../../components/CopyButton.js";
import { ElapsedTime } from "../../components/ElapsedTime.js";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { SectionTitle } from "../../components/SectionTitle.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { api, describeApiError } from "../../lib/api.js";
import { channelQueryKey, useChannelQuery } from "../../lib/channelQuery.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import { queryErrorMessage } from "../../lib/freshness.js";

type ChannelToken = Channel["tokens"][number];

/**
 * The revoke confirm region replaces the token row in place, which is this
 * product's answer to a modal (DESIGN.md #4 Elevation, "Overlays still do not
 * exist"). But the Named overlay focus contract still applies to the swap
 * itself: focus moves onto the region's first control on open, `Escape` does
 * what Cancel does, and `role="group"` plus an `aria-label` naming the token
 * stand in for the trigger a screen reader user just lost.
 */
function TokenRevokeConfirm({
  token,
  revoking,
  onConfirm,
  onCancel,
}: {
  token: ChannelToken;
  revoking: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const revokingLabel = useDelayedPending(revoking);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="confirm-region"
      role="group"
      aria-label={`Confirm revoke token ${token.prefix}…`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <p>Any producer using {token.prefix}… stops being accepted. This cannot be undone.</p>
      <div className="inline-form">
        {/* A destructive commit reads differently from a routine one
            at the moment it fires: outlined, not filled. Still the
            operator's own action, never a lamp color (The Quarantine
            Rule), and this keeps the plate down to one filled
            control even while the confirm region is open. */}
        <button
          ref={confirmRef}
          type="button"
          className="control control-commit"
          onClick={onConfirm}
          disabled={revoking}
        >
          <ShieldOff size={13} strokeWidth={1.75} aria-hidden="true" />
          {revokingLabel ? "Revoking…" : "Confirm revoke"}
        </button>
        <button type="button" className="control" onClick={onCancel} disabled={revoking}>
          <X size={13} strokeWidth={2} aria-hidden="true" />
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Settings tab token management (ADR 0004/0005): mint once, list id/prefix/createdAt, revoke.
 *
 * Reads the Channel through `useChannelQuery` (issue #51) — the same cache entry
 * and the same ~5s freshness interval the parent `ChannelDetailPage` observes,
 * stated once in `lib/channelQuery.ts`. No hand-rolled fetch effect, and no
 * second `getChannel` request for a Channel the parent already holds: this panel
 * mounting reads that entry, and mint/revoke invalidate it so one refetch
 * updates both surfaces.
 */
export function ChannelTokensPanel({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const channelQuery = useChannelQuery(channelId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const mintingLabel = useDelayedPending(minting);
  const [mintedToken, setMintedToken] = useState<ChannelTokenCreated | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Each resting row's Revoke button registers itself here so a Cancel can
  // return focus to the exact trigger that opened its confirm region
  // (DESIGN.md #4 overlay focus contract, issue #61), rather than leaving
  // focus stranded on the confirm region that just unmounted.
  const revokeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const restoreFocusTokenId = useRef<string | null>(null);

  useEffect(() => {
    setConfirmingRevokeId(null);
    setMintedToken(null);
  }, [channelId]);

  useEffect(() => {
    if (confirmingRevokeId === null && restoreFocusTokenId.current) {
      const id = restoreFocusTokenId.current;
      restoreFocusTokenId.current = null;
      revokeButtonRefs.current.get(id)?.focus();
    }
  }, [confirmingRevokeId]);

  function cancelRevoke(tokenId: string): void {
    restoreFocusTokenId.current = tokenId;
    setConfirmingRevokeId(null);
  }

  const tokens = channelQuery.data?.tokens ?? null;
  const loadError = channelQuery.isError
    ? queryErrorMessage(channelQuery.error, "Failed to load tokens")
    : null;
  // The skeleton's own delay-and-hold (DESIGN.md §5): see ChannelActivityTab.
  const showSkeleton = useDelayedPending(tokens === null && !loadError);

  async function handleMint(): Promise<void> {
    setMinting(true);
    setActionError(null);
    try {
      const created = await api.createChannelToken(channelId);
      setMintedToken(created);
      await queryClient.invalidateQueries({ queryKey: channelQueryKey(channelId) });
    } catch (err) {
      setActionError(describeApiError(err, "Failed to mint token"));
    } finally {
      setMinting(false);
    }
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    setRevoking(true);
    setActionError(null);
    try {
      await api.revokeChannelToken(channelId, tokenId);
      if (mintedToken?.id === tokenId) {
        setMintedToken(null);
      }
      setConfirmingRevokeId(null);
      await queryClient.invalidateQueries({ queryKey: channelQueryKey(channelId) });
    } catch (err) {
      setActionError(describeApiError(err, "Failed to revoke token"));
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section className="plate stack">
      <SectionTitle icon={<KeyRound size={13} strokeWidth={2} />}>Ingest tokens</SectionTitle>
      {!showSkeleton && loadError && (
        <InlineLoadError message={loadError} onRetry={() => void channelQuery.refetch()} />
      )}
      {actionError && (
        <p className="error-text" role="alert">
          {actionError}
        </p>
      )}

      {mintedToken && (
        <div className="stack">
          <p className="success-text">New token. This is the only time it is shown:</p>
          <div className="copy-row">
            <code>{mintedToken.token}</code>
            <CopyButton value={mintedToken.token} />
          </div>
        </div>
      )}

      {showSkeleton && <SkeletonRows count={2} label="Loading ingest tokens" />}
      {!showSkeleton && tokens !== null && tokens.length === 0 && (
        <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
          No ingest tokens yet. Mint one below.
        </EmptyState>
      )}
      {!showSkeleton && tokens !== null && tokens.length > 0 && (
        <ul className="row-list">
          {tokens.map((token) => (
            <li key={token.id}>
              {confirmingRevokeId === token.id ? (
                <TokenRevokeConfirm
                  token={token}
                  revoking={revoking}
                  onConfirm={() => void handleRevoke(token.id)}
                  onCancel={() => cancelRevoke(token.id)}
                />
              ) : (
                <div className="row row-token">
                  <span className="token-prefix">{token.prefix}…</span>
                  <span className="row-meta">
                    Created <ElapsedTime iso={token.createdAt} />
                  </span>
                  <button
                    ref={(el) => {
                      if (el) {
                        revokeButtonRefs.current.set(token.id, el);
                      } else {
                        revokeButtonRefs.current.delete(token.id);
                      }
                    }}
                    type="button"
                    // Destructive at rest (DESIGN.md #5, issue #80): Ink Muted
                    // border and bold label read as irreversible before the
                    // press, not only in the confirm region that follows it.
                    className="control control-destructive"
                    onClick={() => setConfirmingRevokeId(token.id)}
                  >
                    <ShieldOff size={13} strokeWidth={1.75} aria-hidden="true" />
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="prose">
        A minted token is shown once, right here. It cannot be retrieved later, only revoked and
        replaced with a new one.
      </p>
      <div className="inline-form">
        <button
          type="button"
          className="control control-primary"
          onClick={() => void handleMint()}
          disabled={minting}
        >
          {/* Creation, not confirmation: a checkmark here would read as "this
              succeeded" on a control that has not run yet. */}
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
          {mintingLabel ? "Minting…" : "Mint new token"}
        </button>
      </div>
    </section>
  );
}
