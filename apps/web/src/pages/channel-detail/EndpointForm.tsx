import { useState, type FormEvent } from "react";
import type { Endpoint } from "@webhook-broadcast/contract";

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
    <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor={`endpoint-url-${initial?.id ?? "new"}`}>URL</label>
      <input
        id={`endpoint-url-${initial?.id ?? "new"}`}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://example.com/webhook"
        required
      />

      <label htmlFor={`endpoint-name-${initial?.id ?? "new"}`}>Name</label>
      <input
        id={`endpoint-name-${initial?.id ?? "new"}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Optional"
      />

      <label htmlFor={`endpoint-timeout-${initial?.id ?? "new"}`}>Timeout (ms)</label>
      <input
        id={`endpoint-timeout-${initial?.id ?? "new"}`}
        type="number"
        min={1}
        value={timeoutMs}
        onChange={(event) => setTimeoutMs(event.target.value)}
        placeholder="Falls back to the global default"
      />

      <label htmlFor={`endpoint-headers-${initial?.id ?? "new"}`}>Headers (JSON)</label>
      <textarea
        id={`endpoint-headers-${initial?.id ?? "new"}`}
        value={headersText}
        onChange={(event) => setHeadersText(event.target.value)}
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

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="inline-form">
        <button type="submit" disabled={saving || url.length === 0}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
