import { useEffect, useState, type FormEvent } from "react";
import { Check, TriangleAlert, X } from "lucide-react";
import {
  endpointHeadersSchema,
  endpointUrlSchema,
  type Endpoint,
} from "@webhook-broadcast/contract";
import { Switch } from "../../components/Switch.js";
import { describeApiError } from "../../lib/api.js";
import { useDelayedPending } from "../../lib/delayedPending.js";
import { useFieldError } from "../../lib/useFieldError.js";

export interface EndpointFormValues {
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
}

/**
 * The rule this field enforces is the contract's, stated once and read here
 * (see ChannelDirectoryPage's `validateSlug` for the sibling of this
 * function): DESIGN.md §5's Reward-Early-Punish-Late Rule says a field
 * "validates locally against the contract schema", so the message a
 * malformed URL earns here is the same sentence the admin API would have
 * returned, not a second paraphrase of it.
 */
function validateUrl(value: string): string | null {
  if (value.length === 0) {
    return "URL is required.";
  }
  const result = endpointUrlSchema.safeParse(value);
  if (result.success) {
    return null;
  }
  return (
    result.error.issues[0]?.message ??
    "URL must be a full URL including the scheme (e.g. https://example.com/webhook)"
  );
}

type HeadersParseResult =
  { success: true; data: Record<string, string> } | { success: false; message: string };

/**
 * Parses the Headers textarea and validates the result against the contract's
 * own `endpointHeadersSchema` — a `Record<string, string>` — rather than a
 * hand-rolled object/array check. That schema is what already rejects
 * `{"a": 1}`, which a hand-written check that only tested for "is this a
 * plain object" let through to the server.
 */
function parseHeaders(text: string): HeadersParseResult {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = trimmed.length > 0 ? JSON.parse(trimmed) : {};
  } catch {
    return {
      success: false,
      message: 'Headers must be valid JSON (e.g. {"x-api-key": "secret"})',
    };
  }
  const result = endpointHeadersSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      message:
        result.error.issues[0]?.message ??
        'Headers must be a JSON object of string values (e.g. {"x-api-key": "secret"})',
    };
  }
  return { success: true, data: result.data };
}

function validateHeaders(text: string): string | null {
  const result = parseHeaders(text);
  return result.success ? null : result.message;
}

export function EndpointForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDirtyChange,
  submitTreatment = "primary",
}: {
  initial?: Endpoint;
  submitLabel: string;
  onSubmit: (values: EndpointFormValues) => Promise<void>;
  onCancel?: () => void;
  /**
   * Fires whenever a field's value diverges from (or returns to) `initial`.
   * The Endpoints tab uses this to guard against a row-to-row swap silently
   * discarding an edit in progress (the 2026-08-14 critique).
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Which treatment the submit control takes, per DESIGN.md §5 Controls: one
   * filled Primary per plate, never two, so whichever instance is not the
   * plate's primary passes "commit". Here the always-mounted New Endpoint
   * form holds the tab's primary and an open edit well passes "commit".
   */
  submitTreatment?: "primary" | "commit";
}) {
  const initialName = initial?.name ?? "";
  const initialUrl = initial?.url ?? "";
  const initialTimeoutMs = initial?.timeoutMs?.toString() ?? "";
  const initialHeadersText = initial ? JSON.stringify(initial.headers, null, 2) : "{}";
  const initialEnabled = initial?.enabled ?? true;

  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [timeoutMs, setTimeoutMs] = useState(initialTimeoutMs);
  const [headersText, setHeadersText] = useState(initialHeadersText);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const savingLabel = useDelayedPending(saving);
  const [error, setError] = useState<string | null>(null);
  const urlField = useFieldError<string, HTMLInputElement>(url, validateUrl);
  const headersField = useFieldError<string, HTMLTextAreaElement>(headersText, validateHeaders);

  // Focus contract for the Endpoint edit swap (DESIGN.md #4): editing an
  // existing Endpoint replaces the row's place in the tab order with this
  // form, so the URL field (its first meaningful control) takes focus on
  // mount rather than leaving it on <body>. The always-mounted "New
  // Endpoint" form has nothing to steal focus from, so it opts out via
  // `initial`.
  useEffect(() => {
    if (initial) {
      urlField.ref.current?.focus();
    }
    // Deliberately mount-only: a fresh `<EndpointForm>` instance is created
    // each time `editingId` changes (see EndpointsTab.tsx, keyed by Endpoint
    // id), so this already refocuses on a row switch without watching
    // `initial`, which would otherwise steal focus back to the URL field on
    // every ~5s poll refresh while an operator is mid-edit.
  }, []);

  useEffect(() => {
    const dirty =
      name !== initialName ||
      url !== initialUrl ||
      timeoutMs !== initialTimeoutMs ||
      headersText !== initialHeadersText ||
      enabled !== initialEnabled;
    onDirtyChange?.(dirty);
  }, [
    name,
    url,
    timeoutMs,
    headersText,
    enabled,
    initialName,
    initialUrl,
    initialTimeoutMs,
    initialHeadersText,
    initialEnabled,
    onDirtyChange,
  ]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // A submit attempt marks every invalid field at once and moves focus to
    // the first of them, rather than sending input the admin API is certain
    // to reject (DESIGN.md §5's Reward-Early-Punish-Late Rule).
    urlField.markTouched();
    headersField.markTouched();
    const headersResult = parseHeaders(headersText);
    const urlInvalid = urlField.isInvalid();
    const headersInvalid = !headersResult.success;
    if (urlInvalid || headersInvalid) {
      (urlInvalid ? urlField.ref : headersField.ref).current?.focus();
      return;
    }
    const headers = headersResult.data;

    setSaving(true);
    setError(null);
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
        urlField.reset();
        headersField.reset();
      }
    } catch (err) {
      setError(describeApiError(err, "Failed to save Endpoint"));
    } finally {
      setSaving(false);
    }
  }

  const urlFieldId = `endpoint-url-${initial?.id ?? "new"}`;
  const urlErrorId = `${urlFieldId}-error`;
  const headersFieldId = `endpoint-headers-${initial?.id ?? "new"}`;
  const headersErrorId = `${headersFieldId}-error`;

  return (
    // `noValidate`: the URL and Headers rules are stated in this form's own
    // voice, and the browser's default bubble would pre-empt those messages and
    // suppress the submit event this form validates on.
    <form className="field-stack" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <div className="field">
        <label htmlFor={urlFieldId}>URL</label>
        <input
          ref={urlField.ref}
          id={urlFieldId}
          className="data"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onBlur={urlField.onBlur}
          placeholder="https://example.com/webhook"
          required
          aria-invalid={urlField.error ? "true" : "false"}
          aria-describedby={urlField.error ? urlErrorId : undefined}
        />
        {urlField.error && (
          <p className="error-text" id={urlErrorId} role="alert">
            <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
            {urlField.error}
          </p>
        )}
      </div>

      {/* Two short fields on one line, which is what keeps the form from
          reading as an undifferentiated column of identical wells. */}
      <div className="field-pair">
        <div className="field">
          <label htmlFor={`endpoint-name-${initial?.id ?? "new"}`}>Name</label>
          <input
            id={`endpoint-name-${initial?.id ?? "new"}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="field">
          <label htmlFor={`endpoint-timeout-${initial?.id ?? "new"}`}>Timeout (ms)</label>
          <input
            id={`endpoint-timeout-${initial?.id ?? "new"}`}
            type="number"
            min={1}
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
            placeholder="Global default"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={headersFieldId}>Headers (JSON)</label>
        <textarea
          ref={headersField.ref}
          id={headersFieldId}
          className="data"
          value={headersText}
          onChange={(event) => setHeadersText(event.target.value)}
          onBlur={headersField.onBlur}
          rows={3}
          aria-invalid={headersField.error ? "true" : "false"}
          aria-describedby={headersField.error ? headersErrorId : undefined}
        />
        {headersField.error && (
          <p className="error-text" id={headersErrorId} role="alert">
            <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
            {headersField.error}
          </p>
        )}
      </div>

      <Switch label="Enabled" checked={enabled} onChange={setEnabled} />

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="inline-form">
        <button
          type="submit"
          className={`control ${submitTreatment === "commit" ? "control-commit" : "control-primary"}`}
          disabled={saving}
        >
          <Check size={13} strokeWidth={2} aria-hidden="true" />
          {savingLabel ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="control" onClick={onCancel}>
            <X size={13} strokeWidth={2} aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
