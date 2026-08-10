import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Channel, Endpoint } from "@webhook-broadcast/contract";
import { api } from "../lib/api.js";

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
  const [tab, setTab] = useState<Tab>("settings");

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
          </header>

          {/* ADR 0004: the Activity tab lands with a later slice. */}
          <nav className="tabs">
            <button type="button" className="tab" disabled title="Coming soon">
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

          {tab === "endpoints" && <EndpointsTab channelId={channel.id} />}
          {tab === "settings" && <ChannelSettingsForm channel={channel} onSaved={setChannel} />}
        </>
      )}
    </div>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSlug(channel.slug);
    setDescription(channel.description ?? "");
    setEnabled(channel.enabled);
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

  useEffect(() => {
    void load();
  }, [load]);

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
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
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
                      {endpoint.timeoutMs ? `${endpoint.timeoutMs}ms` : "default timeout"}
                    </span>
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
