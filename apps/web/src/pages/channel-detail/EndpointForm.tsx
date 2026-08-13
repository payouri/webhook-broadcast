import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import type { Endpoint } from "@webhook-broadcast/contract";
import { Switch } from "../../components/Switch.js";

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
}: {
  initial?: Endpoint;
  submitLabel: string;
  onSubmit: (values: EndpointFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeoutMs?.toString() ?? "");
  const [headersText, setHeadersText] = useState(
    initial ? JSON.stringify(initial.headers, null, 2) : "{}",
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "Failed to save Endpoint");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="field-stack" onSubmit={(event) => void handleSubmit(event)}>
      <div className="field">
        <label htmlFor={`endpoint-url-${initial?.id ?? "new"}`}>URL</label>
        <input
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
          className="control control-primary"
          disabled={saving || url.length === 0}
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
