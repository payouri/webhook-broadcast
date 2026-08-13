import { useCallback, useState } from "react";
import type { Endpoint } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { api } from "../../lib/api.js";
import { usePolling } from "../../lib/freshness.js";
import { EndpointForm } from "./EndpointForm.js";

export function EndpointsTab({ channelId }: { channelId: string }) {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listEndpoints(channelId);
      setEndpoints(list.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Endpoints");
    }
  }, [channelId]);

  usePolling(load);

  return (
    <div className="stack">
      <section className="card">
        <h2>New Endpoint</h2>
        <EndpointForm
          onSubmit={async (input) => {
            await api.createEndpoint(channelId, {
              name: input.name ?? undefined,
              url: input.url,
              timeoutMs: input.timeoutMs ?? undefined,
              headers: input.headers,
              enabled: input.enabled,
            });
            await load();
          }}
          submitLabel="Add Endpoint"
        />
      </section>

      <section className="card">
        <h2>Endpoints</h2>
        {error && <InlineLoadError message={error} onRetry={load} />}
        {endpoints === null && !error && <p className="muted">Loading…</p>}
        {endpoints !== null && endpoints.length === 0 && (
          <p className="muted empty-state">No Endpoints yet — add one above.</p>
        )}
        {endpoints !== null && endpoints.length > 0 && (
          <ul className="channel-list">
            {endpoints.map((endpoint) =>
              editingId === endpoint.id ? (
                <li key={endpoint.id} className="card">
                  <EndpointForm
                    initial={endpoint}
                    submitLabel="Save changes"
                    onSubmit={async (input) => {
                      await api.updateEndpoint(channelId, endpoint.id, input);
                      setEditingId(null);
                      await load();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={endpoint.id}>
                  <button
                    type="button"
                    className="channel-row"
                    onClick={() => setEditingId(endpoint.id)}
                  >
                    <span
                      className={`status-dot ${endpoint.enabled ? "status-on" : "status-off"}`}
                    />
                    <span className="channel-slug">{endpoint.name ?? endpoint.url}</span>
                    <span className="muted channel-description">{endpoint.url}</span>
                    <span className="channel-meta">
                      {endpoint.autoDisabledAt
                        ? `auto-disabled ${new Date(endpoint.autoDisabledAt).toLocaleString()}`
                        : endpoint.timeoutMs
                          ? `${endpoint.timeoutMs}ms`
                          : "default timeout"}
                    </span>
                    {(endpoint.successRate24h != null ||
                      endpoint.p95Ms != null ||
                      endpoint.lastSuccessAt != null) && (
                      <span className="muted channel-meta">
                        {endpoint.successRate24h != null &&
                          `${Math.round(endpoint.successRate24h * 100)}% ok (24h)`}
                        {endpoint.p95Ms != null && ` · p95 ${endpoint.p95Ms}ms`}
                        {endpoint.lastSuccessAt != null &&
                          ` · last ok ${new Date(endpoint.lastSuccessAt).toLocaleString()}`}
                      </span>
                    )}
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
