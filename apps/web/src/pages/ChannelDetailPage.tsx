import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MIN_OPEN_INGEST_SLUG_LENGTH,
  type BroadcastDetail,
  type BroadcastListItem,
  type Channel,
  type ChannelTokenCreated,
  type Endpoint,
} from "@webhook-broadcast/contract";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/freshness.js";
import { DeliveryDetail } from "./DeliveryDetail.js";

type Tab = "activity" | "endpoints" | "settings";

export function ChannelDetailPage({
  channelId,
  onBack,
}: {
  channelId: string;
  onBack: () => void;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activity");

  const load = useCallback(async () => {
    try {
      const result = await api.getChannel(channelId);
      setChannel(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Channel");
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <button type="button" className="button-ghost" onClick={onBack}>
        ← Back to Channels
      </button>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!channel && !error && <p className="muted">Loading…</p>}

      {channel && (
        <>
          <header className="channel-header">
            <span className={`status-dot ${channel.enabled ? "status-on" : "status-off"}`} />
            <h2>{channel.slug}</h2>
            {channel.allowUnauthenticatedIngest && (
              <span
                className="muted"
                title="This Channel accepts POST /ingest without a token — the slug alone gates its fan-out."
              >
                unauthenticated ingest
              </span>
            )}
          </header>

          <nav className="tabs">
            <button
              type="button"
              className={`tab ${tab === "activity" ? "tab-active" : ""}`}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
            <button
              type="button"
              className={`tab ${tab === "endpoints" ? "tab-active" : ""}`}
              onClick={() => setTab("endpoints")}
            >
              Endpoints
            </button>
            <button
              type="button"
              className={`tab ${tab === "settings" ? "tab-active" : ""}`}
              onClick={() => setTab("settings")}
            >
              Settings
            </button>
          </nav>

          {tab === "activity" && <ChannelActivityTab channelId={channelId} />}
          {tab === "endpoints" && <EndpointsTab channelId={channel.id} />}
          {tab === "settings" && (
            <>
              <ChannelSettingsForm channel={channel} onSaved={setChannel} />
              <ChannelTokensPanel channelId={channelId} />
              <ChannelDangerZonePanel channel={channel} onDeleted={onBack} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function fanoutLabel(fanout: BroadcastListItem["fanout"]): string {
  if (fanout.total === 0) {
    return "no Endpoints yet";
  }
  return `${fanout.succeeded}/${fanout.total} succeeded${
    fanout.deadLettered > 0 ? `, ${fanout.deadLettered} dead-lettered` : ""
  }`;
}

/** Channel Activity (ADR 0004): newest-first Broadcasts, ~5s poll, cursor "load more". */
function ChannelActivityTab({ channelId }: { channelId: string }) {
  const [items, setItems] = useState<BroadcastListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await api.listBroadcasts(channelId);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Activity");
    }
  }, [channelId]);

  usePolling(loadFirstPage);

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.listBroadcasts(channelId, nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more Activity");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="card">
      <h2>Activity</h2>
      {error && <InlineLoadError message={error} onRetry={loadFirstPage} />}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items !== null && items.length === 0 && (
        <p className="muted empty-state">
          No Broadcasts yet — send a request to <code>POST /ingest/&lt;slug&gt;</code> with a
          Channel token.
        </p>
      )}
      {items !== null && items.length > 0 && (
        <>
          <ul className="activity-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="activity-row"
                  aria-expanded={expandedId === item.id}
                  onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                >
                  <span className="activity-time">
                    {new Date(item.receivedAt).toLocaleString()}
                  </span>
                  <span className="activity-preview">{item.bodyPreview || "(empty body)"}</span>
                  <span className="muted activity-fanout">{fanoutLabel(item.fanout)}</span>
                </button>
                {expandedId === item.id && (
                  <BroadcastDetailPanel
                    channelId={channelId}
                    broadcastId={item.id}
                    onReplayed={() => void loadFirstPage()}
                  />
                )}
              </li>
            ))}
          </ul>
          {nextCursor && (
            <button
              type="button"
              className="button-ghost"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Broadcast detail (issue #19): inbound payload plus every fanned-out Delivery. */
function BroadcastDetailPanel({
  channelId,
  broadcastId,
  onReplayed,
}: {
  channelId: string;
  broadcastId: string;
  onReplayed?: () => void;
}) {
  const [detail, setDetail] = useState<BroadcastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayedId, setReplayedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.getBroadcastDetail(channelId, broadcastId);
      setDetail(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Broadcast");
    }
  }, [channelId, broadcastId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
  }, [channelId, broadcastId]);

  usePolling(load);

  async function handleReplay(): Promise<void> {
    setReplaying(true);
    setReplayError(null);
    try {
      const { id } = await api.replayBroadcast(channelId, broadcastId);
      setReplayedId(id);
      onReplayed?.();
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : "Failed to replay Broadcast");
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="broadcast-detail">
      {error && <InlineLoadError message={error} onRetry={load} />}
      {!detail && !error && <p className="muted">Loading…</p>}
      {detail && (
        <>
          <p className="muted broadcast-detail-content-type">{detail.contentType}</p>
          <pre className="broadcast-body">{detail.body || "(empty body)"}</pre>

          {/* Replay (issue #22): re-fans the stored payload out to Endpoints
              enabled right now — no new ingest needed. */}
          <div className="broadcast-replay">
            <button
              type="button"
              className="button-ghost"
              onClick={() => void handleReplay()}
              disabled={replaying}
            >
              {replaying ? "Replaying…" : "Replay"}
            </button>
            {replayError && (
              <span className="error-text" role="alert">
                {replayError}
              </span>
            )}
            {replayedId && !replayError && (
              <span className="success-text">Replayed — see it in Activity.</span>
            )}
          </div>

          {detail.deliveries.length === 0 ? (
            <p className="muted empty-state">
              No Endpoints were enabled on this Channel when the Broadcast was accepted.
            </p>
          ) : (
            <ul className="delivery-list">
              {detail.deliveries.map((delivery) => (
                <DeliveryDetail key={delivery.id} delivery={delivery} onRetried={load} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Settings tab token management (ADR 0004/0005): mint once, list id/prefix/createdAt, revoke. */
function ChannelTokensPanel({ channelId }: { channelId: string }) {
  const [tokens, setTokens] = useState<Channel["tokens"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintedToken, setMintedToken] = useState<ChannelTokenCreated | null>(null);

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
    setError(null);
    try {
      await api.revokeChannelToken(channelId, tokenId);
      if (mintedToken?.id === tokenId) {
        setMintedToken(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
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
        <p className="success-text">
          New token (shown once): <code>{mintedToken.token}</code>
        </p>
      )}

      {tokens === null && !error && <p className="muted">Loading…</p>}
      {tokens !== null && tokens.length === 0 && (
        <p className="muted empty-state">No ingest tokens yet — mint one below.</p>
      )}
      {tokens !== null && tokens.length > 0 && (
        <ul className="token-list">
          {tokens.map((token) => (
            <li key={token.id} className="token-row">
              <span className="token-prefix">{token.prefix}…</span>
              <span className="muted">{new Date(token.createdAt).toLocaleString()}</span>
              <button
                type="button"
                className="button-ghost"
                onClick={() => void handleRevoke(token.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => void handleMint()} disabled={minting}>
        {minting ? "Minting…" : "Mint new token"}
      </button>
    </section>
  );
}

function ChannelSettingsForm({
  channel,
  onSaved,
}: {
  channel: Channel;
  onSaved: (channel: Channel) => void;
}) {
  const [slug, setSlug] = useState(channel.slug);
  const [description, setDescription] = useState(channel.description ?? "");
  const [enabled, setEnabled] = useState(channel.enabled);
  const [allowUnauthenticatedIngest, setAllowUnauthenticatedIngest] = useState(
    channel.allowUnauthenticatedIngest,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSlug(channel.slug);
    setDescription(channel.description ?? "");
    setEnabled(channel.enabled);
    setAllowUnauthenticatedIngest(channel.allowUnauthenticatedIngest);
    setSaved(false);
  }, [channel]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateChannel(channel.id, {
        slug,
        description: description.length > 0 ? description : null,
        enabled,
        allowUnauthenticatedIngest,
      });
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor="settings-slug">Slug</label>
      <input
        id="settings-slug"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        required
      />

      <label htmlFor="settings-description">Description</label>
      <textarea
        id="settings-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={3}
      />

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enabled
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={allowUnauthenticatedIngest}
          onChange={(event) => setAllowUnauthenticatedIngest(event.target.checked)}
        />
        Accept unauthenticated ingest
      </label>
      {allowUnauthenticatedIngest && (
        <p className="muted">
          POST /ingest/{slug || "…"} will accept events without an ingest token. The slug is then
          the only thing gating this Channel&apos;s fan-out — use a long, unguessable slug (at least{" "}
          {MIN_OPEN_INGEST_SLUG_LENGTH} characters).
        </p>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {saved && !error && <p className="success-text">Saved.</p>}

      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

/**
 * Settings tab soft-delete (epic US4): removes the Channel from normal use while its Broadcasts and
 * Deliveries are retained until pruned. Distinct from the `enabled` toggle, which stays in Settings.
 */
function ChannelDangerZonePanel({
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

function EndpointsTab({ channelId }: { channelId: string }) {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listEndpoints(channelId);
      setEndpoints(list.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Endpoints");
    }
  }, [channelId]);

  usePolling(load);

  return (
    <div className="stack">
      <section className="card">
        <h2>New Endpoint</h2>
        <EndpointForm
          onSubmit={async (input) => {
            await api.createEndpoint(channelId, {
              name: input.name ?? undefined,
              url: input.url,
              timeoutMs: input.timeoutMs ?? undefined,
              headers: input.headers,
              enabled: input.enabled,
            });
            await load();
          }}
          submitLabel="Add Endpoint"
        />
      </section>

      <section className="card">
        <h2>Endpoints</h2>
        {error && <InlineLoadError message={error} onRetry={load} />}
        {endpoints === null && !error && <p className="muted">Loading…</p>}
        {endpoints !== null && endpoints.length === 0 && (
          <p className="muted empty-state">No Endpoints yet — add one above.</p>
        )}
        {endpoints !== null && endpoints.length > 0 && (
          <ul className="channel-list">
            {endpoints.map((endpoint) =>
              editingId === endpoint.id ? (
                <li key={endpoint.id} className="card">
                  <EndpointForm
                    initial={endpoint}
                    submitLabel="Save changes"
                    onSubmit={async (input) => {
                      await api.updateEndpoint(channelId, endpoint.id, input);
                      setEditingId(null);
                      await load();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={endpoint.id}>
                  <button
                    type="button"
                    className="channel-row"
                    onClick={() => setEditingId(endpoint.id)}
                  >
                    <span
                      className={`status-dot ${endpoint.enabled ? "status-on" : "status-off"}`}
                    />
                    <span className="channel-slug">{endpoint.name ?? endpoint.url}</span>
                    <span className="muted channel-description">{endpoint.url}</span>
                    <span className="channel-meta">
                      {endpoint.autoDisabledAt
                        ? `auto-disabled ${new Date(endpoint.autoDisabledAt).toLocaleString()}`
                        : endpoint.timeoutMs
                          ? `${endpoint.timeoutMs}ms`
                          : "default timeout"}
                    </span>
                    {(endpoint.successRate24h != null ||
                      endpoint.p95Ms != null ||
                      endpoint.lastSuccessAt != null) && (
                      <span className="muted channel-meta">
                        {endpoint.successRate24h != null &&
                          `${Math.round(endpoint.successRate24h * 100)}% ok (24h)`}
                        {endpoint.p95Ms != null && ` · p95 ${endpoint.p95Ms}ms`}
                        {endpoint.lastSuccessAt != null &&
                          ` · last ok ${new Date(endpoint.lastSuccessAt).toLocaleString()}`}
                      </span>
                    )}
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

interface EndpointFormValues {
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
}

function EndpointForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Endpoint;
  submitLabel: string;
  onSubmit: (values: EndpointFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeoutMs?.toString() ?? "");
  const [headersText, setHeadersText] = useState(
    initial ? JSON.stringify(initial.headers, null, 2) : "{}",
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    let headers: Record<string, string>;
    try {
      const parsed: unknown = headersText.trim().length > 0 ? JSON.parse(headersText) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("headers must be a JSON object of string values");
      }
      headers = parsed as Record<string, string>;
    } catch {
      setError('Headers must be valid JSON (e.g. {"x-api-key": "secret"})');
      setSaving(false);
      return;
    }

    try {
      await onSubmit({
        name: name.length > 0 ? name : null,
        url,
        timeoutMs: timeoutMs.length > 0 ? Number(timeoutMs) : null,
        headers,
        enabled,
      });
      if (!initial) {
        setName("");
        setUrl("");
        setTimeoutMs("");
        setHeadersText("{}");
        setEnabled(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Endpoint");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor={`endpoint-url-${initial?.id ?? "new"}`}>URL</label>
      <input
        id={`endpoint-url-${initial?.id ?? "new"}`}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://example.com/webhook"
        required
      />

      <label htmlFor={`endpoint-name-${initial?.id ?? "new"}`}>Name</label>
      <input
        id={`endpoint-name-${initial?.id ?? "new"}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Optional"
      />

      <label htmlFor={`endpoint-timeout-${initial?.id ?? "new"}`}>Timeout (ms)</label>
      <input
        id={`endpoint-timeout-${initial?.id ?? "new"}`}
        type="number"
        min={1}
        value={timeoutMs}
        onChange={(event) => setTimeoutMs(event.target.value)}
        placeholder="Falls back to the global default"
      />

      <label htmlFor={`endpoint-headers-${initial?.id ?? "new"}`}>Headers (JSON)</label>
      <textarea
        id={`endpoint-headers-${initial?.id ?? "new"}`}
        value={headersText}
        onChange={(event) => setHeadersText(event.target.value)}
        rows={3}
      />

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enabled
      </label>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="inline-form">
        <button type="submit" disabled={saving || url.length === 0}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
