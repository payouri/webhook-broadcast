import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { api } from "../lib/api.js";
import { FRESHNESS_POLL_MS, queryErrorMessage } from "../lib/freshness.js";

/** Landing page (ADR 0004): "which Channels exist and are they healthy?" */
export function ChannelDirectoryPage({
  onOpenChannel,
}: {
  onOpenChannel: (channelId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const channelsQuery = useQuery({
    queryKey: ["channels"] as const,
    queryFn: () => api.listChannels(),
    refetchInterval: FRESHNESS_POLL_MS,
  });

  const channels: Channel[] | null = channelsQuery.data?.items ?? null;
  const error = channelsQuery.isError
    ? queryErrorMessage(channelsQuery.error, "Failed to load Channels")
    : null;

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.createChannel({
        slug,
        ...(description.length > 0 ? { description } : {}),
      });
      setSlug("");
      setDescription("");
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
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
            placeholder="slug (lowercase kebab-case, e.g. unipile-dev)"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            title="Lowercase letters, digits, and hyphens only (e.g. unipile-dev)"
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
        {error && <InlineLoadError message={error} onRetry={() => void channelsQuery.refetch()} />}
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
