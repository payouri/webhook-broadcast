import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Info, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { MIN_OPEN_INGEST_SLUG_LENGTH, type Channel } from "@webhook-broadcast/contract";
import { SectionTitle } from "../../components/SectionTitle.js";
import { Switch } from "../../components/Switch.js";
import { api, describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import { ingestUrl } from "../../lib/ingestUrl.js";

export function ChannelSettingsForm({
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
  const savingLabel = useDelayedPending(saving);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [enabledEndpointCount, setEnabledEndpointCount] = useState<number | null>(null);

  const loadEnabledEndpointCount = useCallback(async () => {
    try {
      const endpoints = await api.listEndpoints(channel.id);
      setEnabledEndpointCount(endpoints.items.filter((endpoint) => endpoint.enabled).length);
    } catch {
      // Count unknown: the disable warning is suppressed rather than shown without a count, and
      // the form stays usable either way.
      setEnabledEndpointCount(null);
    }
  }, [channel.id]);

  useEffect(() => {
    setSlug(channel.slug);
    setDescription(channel.description ?? "");
    setEnabled(channel.enabled);
    setAllowUnauthenticatedIngest(channel.allowUnauthenticatedIngest);
    setSaved(false);
    void loadEnabledEndpointCount();
  }, [channel, loadEnabledEndpointCount]);

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
      setError(describeApiError(err, "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="plate field-stack" onSubmit={(event) => void handleSubmit(event)}>
      <SectionTitle icon={<SlidersHorizontal size={13} strokeWidth={2} />}>Settings</SectionTitle>

      <div className="field">
        <label htmlFor="settings-slug">Slug</label>
        <input
          id="settings-slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          required
        />
      </div>
      {/* A consequence advisory; DESIGN.md §5 "Loading, empty, and error"
          states that treatment and why it is neither a lamp nor a live region.
          Only the changed case is stated here: while the slug is untouched the
          Channel's ingest URL is already on screen in the plate above, and
          repeating it verbatim under the field adds a third copy of the same
          string to this tab. */}
      {slug !== channel.slug && (
        <p className="advisory">
          <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
          <span>
            Renaming the slug changes the ingest URL to <code>{ingestUrl(slug || "…")}</code>.
            Producers still posting to <code>{ingestUrl(channel.slug)}</code> will stop being
            accepted.
            {/* Issue #56: this dashboard's own Channel URLs carry the slug too (see
                channelRef.ts), so the same rename strands them the same way — a
                bookmark or a link pasted before the rename shows Channel not
                found instead of this Channel. The id-form URL is unaffected. */}{" "}
            Any dashboard link built from the old slug (a bookmark, a link pasted into chat) stops
            resolving too — it will show Channel not found. Links built from the Channel id are
            unaffected.
          </span>
        </p>
      )}

      <div className="field">
        <label htmlFor="settings-description">Description</label>
        <textarea
          id="settings-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
        />
      </div>

      <div className="switch-group">
        <Switch label="Enabled" checked={enabled} onChange={setEnabled} />
        {/* A consequence advisory (the same treatment as the two advisories
            either side of it): nothing has failed and nothing is invalid, the
            operator is mid-choice. */}
        {!enabled &&
          channel.enabled &&
          enabledEndpointCount !== null &&
          enabledEndpointCount > 0 && (
            <p className="advisory">
              <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
              <span>
                Disabling this Channel stops fan-out to {enabledEndpointCount} enabled{" "}
                {enabledEndpointCount === 1 ? "Endpoint" : "Endpoints"}.
              </span>
            </p>
          )}

        <Switch
          label="Accept unauthenticated ingest"
          checked={allowUnauthenticatedIngest}
          onChange={setAllowUnauthenticatedIngest}
        />
        {allowUnauthenticatedIngest && (
          <p className="advisory">
            <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              POST /ingest/{slug || "…"} will accept events without an ingest token. The slug is
              then the only thing gating this Channel&apos;s fan-out; use a long, unguessable slug
              (at least {MIN_OPEN_INGEST_SLUG_LENGTH} characters).
            </span>
          </p>
        )}
      </div>

      {error && (
        <p className="error-text" role="alert">
          <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}
      {saved && !error && <p className="success-text">Saved.</p>}

      <div className="inline-form">
        <button type="submit" className="control control-primary" disabled={saving}>
          <Check size={13} strokeWidth={2} aria-hidden="true" />
          {savingLabel ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
