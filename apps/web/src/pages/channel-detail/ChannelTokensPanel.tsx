import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChannelTokenCreated } from "@webhook-broadcast/contract";
import { CopyButton } from "../../components/CopyButton.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
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
    <section className="card stack">
      <h2 className="section-title">Ingest tokens</h2>
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

      {tokens === null && !loadError && <p className="muted">Loading…</p>}
      {tokens !== null && tokens.length === 0 && (
        <p className="muted empty-state">No ingest tokens yet. Mint one below.</p>
      )}
      {tokens !== null && tokens.length > 0 && (
        <ul className="token-list">
          {tokens.map((token) => (
            <li key={token.id}>
              {confirmingRevokeId === token.id ? (
                <div className="confirm-region stack">
                  <p>
                    Any producer using {token.prefix}… stops being accepted. This cannot be undone.
                  </p>
                  <div className="inline-form">
                    {/* A destructive commit reads differently from a routine one
                        at the moment it fires (issue #51): outlined Patch Plum,
                        not filled. Still the operator's own action, never a
                        signal color (The Quarantine Rule), and this keeps the
                        panel down to one filled/primary button even while this
                        confirm region is open ("Mint new token" below). */}
                    <button
                      type="button"
                      className="button-confirm-destructive"
                      onClick={() => void handleRevoke(token.id)}
                      disabled={revoking}
                    >
                      {revoking ? "Revoking…" : "Confirm revoke"}
                    </button>
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => setConfirmingRevokeId(null)}
                      disabled={revoking}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="token-row">
                  <span className="token-prefix">{token.prefix}…</span>
                  <span className="muted">{new Date(token.createdAt).toLocaleString()}</span>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() => setConfirmingRevokeId(token.id)}
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        A minted token is shown once, right here. It cannot be retrieved later, only revoked and
        replaced with a new one.
      </p>
      <button type="button" onClick={() => void handleMint()} disabled={minting}>
        {minting ? "Minting…" : "Mint new token"}
      </button>
    </section>
  );
}
