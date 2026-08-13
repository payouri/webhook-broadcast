import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, KeyRound, Plus, ShieldOff, X } from "lucide-react";
import type { ChannelTokenCreated } from "@webhook-broadcast/contract";
import { CopyButton } from "../../components/CopyButton.js";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { SectionTitle } from "../../components/SectionTitle.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { api } from "../../lib/api.js";
import { channelQueryKey, useChannelQuery } from "../../lib/channelQuery.js";
import { queryErrorMessage } from "../../lib/freshness.js";

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
  const [mintedToken, setMintedToken] = useState<ChannelTokenCreated | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    setConfirmingRevokeId(null);
    setMintedToken(null);
  }, [channelId]);

  const tokens = channelQuery.data?.tokens ?? null;
  const loadError = channelQuery.isError
    ? queryErrorMessage(channelQuery.error, "Failed to load tokens")
    : null;

  async function handleMint(): Promise<void> {
    setMinting(true);
    setActionError(null);
    try {
      const created = await api.createChannelToken(channelId);
      setMintedToken(created);
      await queryClient.invalidateQueries({ queryKey: channelQueryKey(channelId) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to mint token");
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
      setActionError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section className="plate stack">
      <SectionTitle icon={<KeyRound size={13} strokeWidth={2} />}>Ingest tokens</SectionTitle>
      {loadError && (
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

      {tokens === null && !loadError && <SkeletonRows count={2} label="Loading ingest tokens" />}
      {tokens !== null && tokens.length === 0 && (
        <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
          No ingest tokens yet. Mint one below.
        </EmptyState>
      )}
      {tokens !== null && tokens.length > 0 && (
        <ul className="row-list">
          {tokens.map((token) => (
            <li key={token.id}>
              {confirmingRevokeId === token.id ? (
                <div className="confirm-region">
                  <p>
                    Any producer using {token.prefix}… stops being accepted. This cannot be undone.
                  </p>
                  <div className="inline-form">
                    {/* A destructive commit reads differently from a routine one
                        at the moment it fires: outlined, not filled. Still the
                        operator's own action, never a lamp color (The Quarantine
                        Rule), and this keeps the plate down to one filled
                        control even while the confirm region is open. */}
                    <button
                      type="button"
                      className="control control-commit"
                      onClick={() => void handleRevoke(token.id)}
                      disabled={revoking}
                    >
                      <ShieldOff size={13} strokeWidth={1.75} aria-hidden="true" />
                      {revoking ? "Revoking…" : "Confirm revoke"}
                    </button>
                    <button
                      type="button"
                      className="control"
                      onClick={() => setConfirmingRevokeId(null)}
                      disabled={revoking}
                    >
                      <X size={13} strokeWidth={2} aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row row-token">
                  <span className="token-prefix">{token.prefix}…</span>
                  <span className="row-meta">{new Date(token.createdAt).toLocaleString()}</span>
                  <button
                    type="button"
                    className="control"
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
          {minting ? "Minting…" : "Mint new token"}
        </button>
      </div>
    </section>
  );
}
