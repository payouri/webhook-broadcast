import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Endpoint } from "@webhook-broadcast/contract";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { EnabledStatusBadge } from "../../components/StatusBadge.js";
import { api } from "../../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { EndpointForm } from "./EndpointForm.js";

export function EndpointsTab({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);

  const endpointsQuery = useQuery({
    queryKey: ["endpoints", channelId] as const,
    queryFn: () => api.listEndpoints(channelId),
    refetchInterval: freshnessRefetchInterval,
  });
  useRefetchOnVisible(() => void endpointsQuery.refetch());

  const endpoints: Endpoint[] | null = endpointsQuery.data?.items ?? null;
  const error = endpointsQuery.isError
    ? queryErrorMessage(endpointsQuery.error, "Failed to load Endpoints")
    : null;

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["endpoints", channelId] });
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>New Endpoint</h2>
        <EndpointForm
          onSubmit={async (input) => {
            await api.createEndpoint(channelId, {
              url: input.url,
              ...(input.name !== null ? { name: input.name } : {}),
              ...(input.timeoutMs !== null ? { timeoutMs: input.timeoutMs } : {}),
              headers: input.headers,
              enabled: input.enabled,
            });
            await refresh();
          }}
          submitLabel="Add Endpoint"
        />
      </section>

      <section className="card">
        <h2>Endpoints</h2>
        {error && <InlineLoadError message={error} onRetry={() => void endpointsQuery.refetch()} />}
        {endpoints === null && !error && <p className="muted">Loading…</p>}
        {endpoints !== null && endpoints.length === 0 && (
          <p className="muted empty-state">No Endpoints yet. Add one above.</p>
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
                      await refresh();
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
                    <EnabledStatusBadge
                      enabled={endpoint.enabled}
                      autoDisabledAt={endpoint.autoDisabledAt}
                    />
                    <span className="channel-slug">{endpoint.name ?? endpoint.url}</span>
                    <span className="muted channel-description">{endpoint.url}</span>
                    <span className="channel-meta">
                      {endpoint.autoDisabledAt
                        ? `since ${new Date(endpoint.autoDisabledAt).toLocaleString()}`
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
