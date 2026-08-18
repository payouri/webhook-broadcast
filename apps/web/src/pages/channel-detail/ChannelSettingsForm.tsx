import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Info, SlidersHorizontal, TriangleAlert } from "lucide-react";
import {
  DEFAULT_INGEST_SUCCESS_STATUS,
  MIN_OPEN_INGEST_SLUG_LENGTH,
  channelUpdateSchema,
  type Channel,
} from "@webhook-broadcast/contract";
import { SectionTitle } from "../../components/SectionTitle.js";
import { Switch } from "../../components/Switch.js";
import { api, describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import { ingestUrl } from "../../lib/ingestUrl.js";
import { useFieldError } from "../../lib/useFieldError.js";

/**
 * The rule this field enforces is the contract's, stated once and read here —
 * DESIGN.md §5's Reward-Early-Punish-Late Rule says a field "validates locally
 * against the contract schema", and the schema's own message is what the admin
 * API would have returned, so the field and the server say the same sentence
 * rather than two paraphrases of one rule.
 *
 * The pair is parsed through `channelUpdateSchema` — the request body's own
 * schema — rather than through `channelSlugSchema` alone, because one of this
 * field's constraints is not the slug's on its own: an open-ingest Channel's
 * slug is the only thing gating its fan-out, so the contract refines the slug's
 * minimum length against the switch beside it. Sending both through the schema
 * is what keeps that length and its wording out of this file, per DESIGN.md's
 * "Don't restate a contract constraint as a hand-written check in `apps/web`".
 */
/**
 * Issue #99: blank means "inherit the service-wide default", which is the
 * common case — so the field is empty, not pre-filled with 202, and only a
 * deployment whose producer disagrees ever types here. The 2xx rule is the
 * contract's, read from `channelUpdateSchema` rather than restated, the same
 * way the slug field reads its own.
 */
function validateIngestSuccessStatus(value: string): string | null {
  if (value.trim().length === 0) {
    return null;
  }
  const result = channelUpdateSchema.safeParse({ ingestSuccessStatus: Number(value) });
  if (result.success) {
    return null;
  }
  const issue = result.error.issues.find(
    (candidate) => candidate.path[0] === "ingestSuccessStatus",
  );
  return issue?.message ?? "Enter a 2xx status code.";
}

function makeValidateSlug(allowUnauthenticatedIngest: boolean) {
  return (value: string): string | null => {
    if (value.length === 0) {
      return "Slug is required — it is the ingest path segment.";
    }
    const result = channelUpdateSchema.safeParse({ slug: value, allowUnauthenticatedIngest });
    if (result.success) {
      return null;
    }
    const slugIssue = result.error.issues.find((issue) => issue.path[0] === "slug");
    return slugIssue?.message ?? "slug must be lowercase kebab-case (a-z, 0-9, -)";
  };
}

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
  const [ingestSuccessStatus, setIngestSuccessStatus] = useState(
    channel.ingestSuccessStatus === null ? "" : String(channel.ingestSuccessStatus),
  );
  const [saving, setSaving] = useState(false);
  const savingLabel = useDelayedPending(saving);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [enabledEndpointCount, setEnabledEndpointCount] = useState<number | null>(null);

  // Silent on first pass, announced once the field has been left or submitted,
  // then live on every keystroke until it clears (DESIGN.md §5). The timing is
  // the shared hook's, not this form's: the rule is stated once and read here,
  // the same way the constraint it enforces is.
  const slugField = useFieldError<string, HTMLInputElement>(
    slug,
    makeValidateSlug(allowUnauthenticatedIngest),
  );

  const ingestSuccessStatusField = useFieldError<string, HTMLInputElement>(
    ingestSuccessStatus,
    validateIngestSuccessStatus,
  );

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

  const resetSlugField = slugField.reset;
  const resetIngestSuccessStatusField = ingestSuccessStatusField.reset;

  useEffect(() => {
    setSlug(channel.slug);
    setDescription(channel.description ?? "");
    setEnabled(channel.enabled);
    setAllowUnauthenticatedIngest(channel.allowUnauthenticatedIngest);
    setIngestSuccessStatus(
      channel.ingestSuccessStatus === null ? "" : String(channel.ingestSuccessStatus),
    );
    setSaved(false);
    resetSlugField();
    resetIngestSuccessStatusField();
    void loadEnabledEndpointCount();
  }, [channel, loadEnabledEndpointCount, resetSlugField, resetIngestSuccessStatusField]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // A submit attempt marks every invalid field at once and moves focus to
    // the first of them, rather than sending input the admin API is certain
    // to reject (DESIGN.md §5's Reward-Early-Punish-Late Rule).
    slugField.markTouched();
    ingestSuccessStatusField.markTouched();
    if (slugField.isInvalid()) {
      slugField.ref.current?.focus();
      return;
    }
    if (ingestSuccessStatusField.isInvalid()) {
      ingestSuccessStatusField.ref.current?.focus();
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateChannel(channel.id, {
        slug,
        description: description.length > 0 ? description : null,
        enabled,
        allowUnauthenticatedIngest,
        ingestSuccessStatus:
          ingestSuccessStatus.trim().length > 0 ? Number(ingestSuccessStatus) : null,
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
    <form className="plate field-stack" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <SectionTitle icon={<SlidersHorizontal size={13} strokeWidth={2} />}>Settings</SectionTitle>

      <div className="field">
        <label htmlFor="settings-slug">Slug</label>
        <input
          ref={slugField.ref}
          id="settings-slug"
          className="field-control"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          onBlur={slugField.onBlur}
          required
          aria-invalid={slugField.error ? "true" : "false"}
          aria-describedby={slugField.error ? "settings-slug-error" : undefined}
        />
        {slugField.error && (
          <p className="error-text" id="settings-slug-error" role="alert">
            <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
            {slugField.error}
          </p>
        )}
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
          className="field-control"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
        />
      </div>

      <div className="field">
        <label htmlFor="settings-ingest-success-status">Ingest success status</label>
        <input
          ref={ingestSuccessStatusField.ref}
          id="settings-ingest-success-status"
          className="field-control"
          type="number"
          inputMode="numeric"
          min={200}
          max={299}
          placeholder={`Inherit (${DEFAULT_INGEST_SUCCESS_STATUS})`}
          value={ingestSuccessStatus}
          onChange={(event) => setIngestSuccessStatus(event.target.value)}
          onBlur={ingestSuccessStatusField.onBlur}
          aria-invalid={ingestSuccessStatusField.error ? "true" : "false"}
          aria-describedby={
            ingestSuccessStatusField.error ? "settings-ingest-success-status-error" : undefined
          }
        />
        {ingestSuccessStatusField.error ? (
          <p className="error-text" id="settings-ingest-success-status-error" role="alert">
            <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
            {ingestSuccessStatusField.error}
          </p>
        ) : (
          <p className="advisory">
            <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              What POST /ingest/{slug || "…"} answers when it accepts a Broadcast. Leave blank to
              inherit this deployment&apos;s default. Set it only for a producer that treats another
              2xx as a failure and retries an event that was already accepted — every retry becomes
              another Broadcast, fanned out to every Endpoint.
            </span>
          </p>
        )}
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
              POST /ingest/{slug || "…"} will accept Broadcasts without an ingest token. The slug is
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
