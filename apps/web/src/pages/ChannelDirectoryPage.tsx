import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Inbox, Plus, Radio } from "lucide-react";
import type { Channel } from "@webhook-broadcast/contract";
import { EmptyState } from "../components/EmptyState.js";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { SectionTitle } from "../components/SectionTitle.js";
import { SkeletonRows } from "../components/SkeletonRows.js";
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
      {/* Every route needs exactly one h1 describing that view; this one is
          visually hidden because the engraved legends below already give the
          directory its on-screen structure. */}
      <h1 className="visually-hidden">Channel directory</h1>

      {/* `plate-wide` because this plate's content is a horizontal form, not
          prose: at the 72ch prose cap its three controls squeezed to ~208px each
          and the slug placeholder, which is where the format rule is stated, was
          clipped mid-sentence. */}
      <section className="plate plate-wide stack">
        <SectionTitle icon={<Plus size={13} strokeWidth={2} />}>New Channel</SectionTitle>
        <form className="inline-form" onSubmit={(event) => void handleCreate(event)}>
          <input
            id="new-channel-slug"
            name="slug"
            aria-label="Slug"
            placeholder="slug (lowercase kebab-case, e.g. unipile-dev)"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            title="Lowercase letters, digits, and hyphens only (e.g. unipile-dev)"
          />
          <input
            id="new-channel-description"
            name="description"
            aria-label="Description"
            placeholder="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button
            type="submit"
            className="control control-primary"
            disabled={creating || slug.length === 0}
          >
            {creating ? "Creating…" : "Create Channel"}
          </button>
        </form>
        {createError && (
          <p className="error-text" role="alert">
            {createError}
          </p>
        )}
      </section>

      {/* A list-only region: no form, no prose, nothing a plate's border and
          prose cap would earn it. Just a legend and the row list, at the full
          tabular width the column allows. */}
      <section className="list-section">
        <SectionTitle icon={<Radio size={13} strokeWidth={2} />}>Channels</SectionTitle>
        {error && <InlineLoadError message={error} onRetry={() => void channelsQuery.refetch()} />}
        {channels === null && !error && <SkeletonRows label="Loading Channels" />}
        {channels !== null && channels.length === 0 && (
          <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
            No Channels yet. Create one above.
          </EmptyState>
        )}
        {channels !== null && channels.length > 0 && (
          <ul className="row-list">
            {channels.map((channel) => (
              <li key={channel.id}>
                {/* A Channel with recent failures lands straight on the filtered
                    Activity view: the count this row names and the Broadcasts
                    behind it are one navigation apart. */}
                <button
                  type="button"
                  className="row row-channel"
                  onClick={() => navigate(channelActivityHref(channel))}
                >
                  <EnabledStatusBadge enabled={channel.enabled} />
                  <span className="row-name">{channel.slug}</span>
                  <span className="muted row-truncate">
                    {channel.description ?? "No description"}
                  </span>
                  <ChannelHealthBadge
                    enabled={channel.enabled}
                    hasBroadcasts={channel.hasBroadcasts}
                    recentFailedDeliveryCount={channel.recentFailedDeliveryCount}
                    autoDisabledEndpointCount={channel.autoDisabledEndpointCount}
                  />
                  <span className="row-meta">
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
