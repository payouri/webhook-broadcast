import { useCallback, useEffect, useState } from "react";
import type { Channel, ChannelTokenCreated } from "@webhook-broadcast/contract";
import { CopyButton } from "../../components/CopyButton.js";
import { api } from "../../lib/api.js";

/** Settings tab token management (ADR 0004/0005): mint once, list id/prefix/createdAt, revoke. */
export function ChannelTokensPanel({ channelId }: { channelId: string }) {
  const [tokens, setTokens] = useState<Channel["tokens"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintedToken, setMintedToken] = useState<ChannelTokenCreated | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    try {
      const channel = await api.getChannel(channelId);
      setTokens(channel.tokens);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
    }
  }, [channelId]);

  useEffect(() => {
    setConfirmingRevokeId(null);
    void load();
  }, [load]);

  async function handleMint(): Promise<void> {
    setMinting(true);
    setError(null);
    try {
      const created = await api.createChannelToken(channelId);
      setMintedToken(created);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint token");
    } finally {
      setMinting(false);
    }
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    setRevoking(true);
    setError(null);
    try {
      await api.revokeChannelToken(channelId, tokenId);
      if (mintedToken?.id === tokenId) {
        setMintedToken(null);
      }
      setConfirmingRevokeId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Ingest tokens</h2>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {mintedToken && (
        <div className="stack">
          <p className="success-text">New token — this is the only time it is shown:</p>
          <div className="copy-row">
            <code>{mintedToken.token}</code>
            <CopyButton value={mintedToken.token} />
          </div>
        </div>
      )}

      {tokens === null && !error && <p className="muted">Loading…</p>}
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
                    <button
                      type="button"
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
        A minted token is shown once, right here — it cannot be retrieved later, only revoked and
        replaced with a new one.
      </p>
      <button type="button" onClick={() => void handleMint()} disabled={minting}>
        {minting ? "Minting…" : "Mint new token"}
      </button>
    </section>
  );
}
