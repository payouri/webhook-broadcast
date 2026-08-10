import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Channel } from "@webhook-broadcast/contract";
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

          {/* ADR 0004: Activity and Endpoints tabs land with later slices. */}
          <nav className="tabs">
            <button type="button" className="tab" disabled title="Coming soon">
              Activity
            </button>
            <button type="button" className="tab" disabled title="Coming soon">
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
