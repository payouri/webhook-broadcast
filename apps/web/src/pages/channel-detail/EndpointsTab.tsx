import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Plug, Plus, Power } from "lucide-react";
import type { Endpoint } from "@webhook-broadcast/contract";
import { EmptyState } from "../../components/EmptyState.js";
import { InlineLoadError } from "../../components/InlineLoadError.js";
import { SectionTitle } from "../../components/SectionTitle.js";
import { SkeletonRows } from "../../components/SkeletonRows.js";
import { EnabledStatusBadge } from "../../components/StatusBadge.js";
import { api } from "../../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../../lib/freshness.js";
import { EndpointForm } from "./EndpointForm.js";

/**
 * Issue #52: an auto-disabled Endpoint (ADR 0003) was the interface's one
 * genuinely silent failure — the row named the state and a timestamp and
 * nothing else, so an operator who has not read the ADR could not tell what
 * triggered it, whether it recovers, or what to do. This sits below the row
 * (never inside its `<button>`, so the re-enable action never opens edit
 * mode) in a recessed well, attached to the row it explains rather than a
 * step removed in an edit form.
 *
 * The threshold is named as "the configured auto-disable window" rather than
 * a hardcoded duration: `ENDPOINT_AUTO_DISABLE_AFTER_MS` is not on the wire
 * today, and a deployment may have overridden its default, so printing the
 * built-in default here would be printing a fact that is not necessarily
 * true of this deployment. Stating the rule without the number stays correct
 * either way (issue #52's stated fallback when surfacing the env var would
 * be a disproportionate contract change for this one line of copy).
 */
function EndpointAutoDisabledNotice({
  channelId,
  endpoint,
  onReenabled,
}: {
  channelId: string;
  endpoint: Endpoint;
  onReenabled: () => Promise<void>;
}) {
  const [reenabling, setReenabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReenable(): Promise<void> {
    setReenabling(true);
    setError(null);
    try {
      await api.updateEndpoint(channelId, endpoint.id, { enabled: true });
      await onReenabled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-enable Endpoint");
      setReenabling(false);
    }
  }

  return (
    <div className="confirm-region well-notice">
      <p>
        Auto-disabled: a failure streak, every Delivery failed with no successful Delivery in
        between, held past the configured auto-disable window. It does not recover on its own; only
        an operator re-enabling it resumes Deliveries.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="inline-form">
        {/* Not the filled primary: that is reserved for "the single committing
            action in a plate, one per plate, never two", and this notice
            renders once per auto-disabled Endpoint, so a filled control here
            would stack N of them down one list and spend the accent's 10%
            budget on a failure state — the volume PRODUCT.md principle 4 rules
            out. The tab's one primary stays "Add Endpoint". */}
        <button
          type="button"
          className="control"
          onClick={() => void handleReenable()}
          disabled={reenabling}
        >
          <Power size={13} strokeWidth={1.75} aria-hidden="true" />
          {reenabling ? "Re-enabling…" : "Re-enable"}
        </button>
      </div>
    </div>
  );
}

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
      <section className="plate stack">
        <SectionTitle icon={<Plus size={13} strokeWidth={2} />}>New Endpoint</SectionTitle>
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

      {/* A list-only region: see ChannelDirectoryPage's Channels section. */}
      <section className="list-section">
        <SectionTitle icon={<Plug size={13} strokeWidth={2} />}>Endpoints</SectionTitle>
        {error && <InlineLoadError message={error} onRetry={() => void endpointsQuery.refetch()} />}
        {endpoints === null && !error && <SkeletonRows label="Loading Endpoints" />}
        {endpoints !== null && endpoints.length === 0 && (
          <EmptyState icon={<Inbox size={20} strokeWidth={1.5} />}>
            No Endpoints yet. Add one above.
          </EmptyState>
        )}
        {endpoints !== null && endpoints.length > 0 && (
          <ul className="row-list">
            {endpoints.map((endpoint) =>
              editingId === endpoint.id ? (
                // Never a plate nested in a plate: an inset well, the same idiom
                // the Broadcast and Delivery detail use (The Inward Depth Rule).
                <li key={endpoint.id} className="well well-endpoint-edit">
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
                    className="row row-channel"
                    onClick={() => setEditingId(endpoint.id)}
                  >
                    <EnabledStatusBadge
                      enabled={endpoint.enabled}
                      autoDisabledAt={endpoint.autoDisabledAt}
                    />
                    <span className="row-name">{endpoint.name ?? endpoint.url}</span>
                    <span className="muted row-truncate">{endpoint.url}</span>
                    <span className="row-meta">
                      {endpoint.autoDisabledAt
                        ? `since ${new Date(endpoint.autoDisabledAt).toLocaleString()}`
                        : endpoint.timeoutMs
                          ? `${endpoint.timeoutMs}ms`
                          : "default timeout"}
                    </span>
                    {(endpoint.successRate24h != null ||
                      endpoint.p95Ms != null ||
                      endpoint.lastSuccessAt != null) && (
                      <span className="row-meta">
                        {endpoint.successRate24h != null &&
                          `${Math.round(endpoint.successRate24h * 100)}% ok (24h)`}
                        {endpoint.p95Ms != null && ` · p95 ${endpoint.p95Ms}ms`}
                        {endpoint.lastSuccessAt != null &&
                          ` · last ok ${new Date(endpoint.lastSuccessAt).toLocaleString()}`}
                      </span>
                    )}
                  </button>
                  {endpoint.autoDisabledAt && (
                    <EndpointAutoDisabledNotice
                      channelId={channelId}
                      endpoint={endpoint}
                      onReenabled={refresh}
                    />
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
