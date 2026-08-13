import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MIN_OPEN_INGEST_SLUG_LENGTH, type Channel } from "@webhook-broadcast/contract";
import { api } from "../../lib/api.js";
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
      {/* Only the changed case is stated here: while the slug is untouched the
          Channel's ingest URL is already on screen in the panel above, and
          repeating it verbatim under the field adds a third copy of the same
          string to this tab. */}
      {slug !== channel.slug && (
        <p className="error-text" role="alert">
          Renaming the slug changes the ingest URL to <code>{ingestUrl(slug || "…")}</code>.
          Producers still posting to <code>{ingestUrl(channel.slug)}</code> will stop being
          accepted.
        </p>
      )}

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
      {!enabled && channel.enabled && enabledEndpointCount !== null && enabledEndpointCount > 0 && (
        <p className="error-text" role="alert">
          Disabling this Channel stops fan-out to {enabledEndpointCount} enabled{" "}
          {enabledEndpointCount === 1 ? "Endpoint" : "Endpoints"}.
        </p>
      )}

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
          the only thing gating this Channel&apos;s fan-out; use a long, unguessable slug (at least{" "}
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
