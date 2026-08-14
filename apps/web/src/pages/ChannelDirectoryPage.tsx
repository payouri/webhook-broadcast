import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Inbox, Info, Plus, Radio, TriangleAlert } from "lucide-react";
import { channelSlugSchema, type Channel } from "@webhook-broadcast/contract";
import { EmptyState } from "../components/EmptyState.js";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { SectionTitle } from "../components/SectionTitle.js";
import { SkeletonRows } from "../components/SkeletonRows.js";
import { ChannelHealthBadge, EnabledStatusBadge } from "../components/StatusBadge.js";
import { channelActivityHref } from "../lib/activityFilter.js";
import { api, describeApiError } from "../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../lib/freshness.js";

/**
 * The rule this field enforces is the contract's, stated once and read here —
 * DESIGN.md §5's Reward-Early-Punish-Late Rule says a field "validates locally
 * against the contract schema", and the schema's own message is what the admin
 * API would have returned, so the field and the server say the same sentence
 * rather than two paraphrases of one rule.
 */
function validateSlug(value: string): string | null {
  if (value.length === 0) {
    return "Slug is required — it is the ingest path segment.";
  }
  const result = channelSlugSchema.safeParse(value);
  if (result.success) {
    return null;
  }
  return result.error.issues[0]?.message ?? "slug must be lowercase kebab-case (a-z, 0-9, -)";
}

/** Landing page (ADR 0004): "which Channels exist and are they healthy?" */
export function ChannelDirectoryPage() {
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = "Channels · webhook-broadcast";
  }, []);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const slugRef = useRef<HTMLInputElement>(null);
  // Silent on first pass, announced once the field has been left or submitted,
  // then live on every keystroke until it clears (DESIGN.md §5).
  const slugValidationError = slugTouched ? validateSlug(slug) : null;

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
    setSlugTouched(true);
    // A submit attempt marks the invalid field and moves focus to it rather
    // than sending input the admin API is certain to reject (DESIGN.md §5).
    if (validateSlug(slug) !== null) {
      slugRef.current?.focus();
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await api.createChannel({
        slug,
        ...(description.length > 0 ? { description } : {}),
      });
      setSlug("");
      setDescription("");
      setSlugTouched(false);
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
    } catch (err) {
      setCreateError(describeApiError(err, "Failed to create Channel"));
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

      {/* A list-only region: no form, no prose, nothing a plate's border and
          prose cap would earn it. Just a legend and the row list, at the full
          tabular width the column allows. Health before detail (PRODUCT.md §1). */}
      <section className="list-section">
        <SectionTitle icon={<Radio size={13} strokeWidth={2} />}>Channels</SectionTitle>
        {error && <InlineLoadError message={error} onRetry={() => void channelsQuery.refetch()} />}
        {channels === null && !error && <SkeletonRows label="Loading Channels" />}
        {channels !== null && channels.length === 0 && (
          <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
            No Channels yet. Create one below.
          </EmptyState>
        )}
        {channels !== null && channels.length > 0 && (
          <ul className="row-list row-list-channel">
            {channels.map((channel) => (
              <li key={channel.id}>
                {/* A Channel with recent failures lands straight on the filtered
                    Activity view: the count this row names and the Broadcasts
                    behind it are one navigation apart. */}
                <Link to={channelActivityHref(channel)} className="row row-channel">
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
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Below the list, so the directory's prime slot answers "is anything
          broken here?" before it offers a create form (PRODUCT.md §1). Still on
          the page and still one scroll away: no modal, no navigation. A plate at
          the ordinary prose cap now that the form is a vertical field-stack —
          the earlier `plate-wide` opt-out existed for a row of inline controls
          that no longer exists. */}
      <section className="plate stack">
        <SectionTitle icon={<Plus size={13} strokeWidth={2} />}>New Channel</SectionTitle>
        {/* `noValidate`: the slug rule is stated in this form's own voice, and
            the browser's default bubble would pre-empt that message and suppress
            the submit event this form validates on. */}
        <form className="field-stack" noValidate onSubmit={(event) => void handleCreate(event)}>
          <div className="field">
            <label htmlFor="new-channel-slug">Slug</label>
            <input
              ref={slugRef}
              id="new-channel-slug"
              name="slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              onBlur={() => setSlugTouched(true)}
              placeholder="unipile-dev"
              required
              aria-invalid={slugValidationError ? "true" : "false"}
              aria-describedby={
                slugValidationError
                  ? "new-channel-slug-rule new-channel-slug-error"
                  : "new-channel-slug-rule"
              }
            />
            {/* The format rule is standing guidance, not a validation result, so
                it is present before the first keystroke and stays legible during
                and after typing — where the old placeholder-and-`title` pair
                stated it only while the field was empty, and never to a keyboard
                or touch operator. */}
            <p className="advisory" id="new-channel-slug-rule">
              <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
              <span>
                Lowercase letters, digits, and hyphens between them (e.g. <code>unipile-dev</code>).
                The slug is the ingest path: <code>POST /ingest/&lt;slug&gt;</code>.
              </span>
            </p>
            {slugValidationError && (
              <p className="error-text" id="new-channel-slug-error" role="alert">
                <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
                {slugValidationError}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="new-channel-description">Description</label>
            <input
              id="new-channel-description"
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Disabled only while a request is genuinely in flight: a commit
              control does not express invalidity by going dead (DESIGN.md §5).
              Pressing it with an invalid slug is the path that forces the
              message onto the screen. */}
          <button type="submit" className="control control-primary" disabled={creating}>
            {creating ? "Creating…" : "Create Channel"}
          </button>

          {createError && (
            <p className="error-text" role="alert">
              <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
              {createError}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
