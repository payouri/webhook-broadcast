import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import type { Endpoint } from "@webhook-broadcast/contract";
import { Switch } from "../../components/Switch.js";
import { describeApiError } from "../../lib/api.js";

export interface EndpointFormValues {
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  // Focus contract for the Endpoint edit swap (DESIGN.md #4): editing an
  // existing Endpoint replaces the row's place in the tab order with this
  // form, so the URL field (its first meaningful control) takes focus on
  // mount rather than leaving it on <body>. The always-mounted "New
  // Endpoint" form has nothing to steal focus from, so it opts out via
  // `initial`.
  useEffect(() => {
    if (initial) {
      urlRef.current?.focus();
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
    setSaving(true);
    setError(null);

    let headers: Record<string, string>;
    try {
      const parsed: unknown = headersText.trim().length > 0 ? JSON.parse(headersText) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("headers must be a JSON object of string values");
      }
      headers = parsed as Record<string, string>;
    } catch {
      setError('Headers must be valid JSON (e.g. {"x-api-key": "secret"})');
      setSaving(false);
      return;
    }

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
      }
    } catch (err) {
      setError(describeApiError(err, "Failed to save Endpoint"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="field-stack" onSubmit={(event) => void handleSubmit(event)}>
      <div className="field">
        <label htmlFor={`endpoint-url-${initial?.id ?? "new"}`}>URL</label>
        <input
          ref={urlRef}
          id={`endpoint-url-${initial?.id ?? "new"}`}
          className="data"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/webhook"
          required
        />
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
        <label htmlFor={`endpoint-headers-${initial?.id ?? "new"}`}>Headers (JSON)</label>
        <textarea
          id={`endpoint-headers-${initial?.id ?? "new"}`}
          className="data"
          value={headersText}
          onChange={(event) => setHeadersText(event.target.value)}
          rows={3}
        />
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
          {saving ? "Saving…" : submitLabel}
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
