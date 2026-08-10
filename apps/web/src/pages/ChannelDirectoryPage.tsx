import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Channel } from "@webhook-broadcast/contract";
import { api } from "../lib/api.js";

/** Landing page (ADR 0004): "which Channels exist and are they healthy?" */
export function ChannelDirectoryPage({
  onOpenChannel,
}: {
  onOpenChannel: (channelId: string) => void;
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listChannels();
      setChannels(list.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Channels");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.createChannel({
        slug,
        description: description.length > 0 ? description : undefined,
      });
      setSlug("");
      setDescription("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create Channel");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>New Channel</h2>
        <form className="inline-form" onSubmit={(event) => void handleCreate(event)}>
          <input
            aria-label="Slug"
            placeholder="slug (e.g. orders)"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
          />
          <input
            aria-label="Description"
            placeholder="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button type="submit" disabled={creating || slug.length === 0}>
            {creating ? "Creating…" : "Create Channel"}
          </button>
        </form>
        {createError && (
          <p className="error-text" role="alert">
            {createError}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Channels</h2>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {channels === null && !error && <p className="muted">Loading…</p>}
        {channels !== null && channels.length === 0 && (
          <p className="muted empty-state">No Channels yet — create one above.</p>
        )}
        {channels !== null && channels.length > 0 && (
          <ul className="channel-list">
            {channels.map((channel) => (
              <li key={channel.id}>
                <button
                  type="button"
                  className="channel-row"
                  onClick={() => onOpenChannel(channel.id)}
                >
                  <span className={`status-dot ${channel.enabled ? "status-on" : "status-off"}`} />
                  <span className="channel-slug">{channel.slug}</span>
                  <span className="muted channel-description">
                    {channel.description ?? "No description"}
                  </span>
                  <span className="channel-meta">
                    {channel.endpointCount} endpoint{channel.endpointCount === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
