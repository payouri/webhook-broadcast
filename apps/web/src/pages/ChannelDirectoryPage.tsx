import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { Channel } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { ChannelHealthBadge, EnabledStatusBadge } from "../components/StatusBadge.js";
import { channelActivityHref } from "../lib/activityFilter.js";
import { api } from "../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../lib/freshness.js";

/** Landing page (ADR 0004): "which Channels exist and are they healthy?" */
export function ChannelDirectoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = "Channels · webhook-broadcast";
  }, []);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const channelsQuery = useQuery({
    queryKey: ["channels"] as const,
    queryFn: () => api.listChannels(),
    refetchInterval: freshnessRefetchInterval,
  });
  useRefetchOnVisible(() => void channelsQuery.refetch());

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
      {/* Every route needs exactly one h1 describing that view (issue #51); this
          one is visually hidden because the panel headings below it already
          give the directory its on-screen structure. */}
      <h1 className="visually-hidden">Channel directory</h1>
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
          <p className="muted empty-state">No Channels yet. Create one above.</p>
        )}
        {channels !== null && channels.length > 0 && (
          <ul className="channel-list">
            {channels.map((channel) => (
              <li key={channel.id}>
                {/* A Channel with recent failures lands straight on the filtered
                    Activity view (issue #51): the count this row names and the
                    Broadcasts behind it are one navigation apart. */}
                <button
                  type="button"
                  className="channel-row"
                  onClick={() => navigate(channelActivityHref(channel))}
                >
                  <EnabledStatusBadge enabled={channel.enabled} />
                  <span className="channel-slug">{channel.slug}</span>
                  <span className="muted channel-description">
                    {channel.description ?? "No description"}
                  </span>
                  <ChannelHealthBadge
                    enabled={channel.enabled}
                    hasBroadcasts={channel.hasBroadcasts}
                    recentFailedDeliveryCount={channel.recentFailedDeliveryCount}
                    autoDisabledEndpointCount={channel.autoDisabledEndpointCount}
                  />
                  <span className="channel-meta">
                    {channel.endpointCount} Endpoint{channel.endpointCount === 1 ? "" : "s"}
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
