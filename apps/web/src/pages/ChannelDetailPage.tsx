import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError, api } from "../lib/api.js";
import {
  freshnessRefetchInterval,
  queryErrorMessage,
  useRefetchOnVisible,
} from "../lib/freshness.js";
import { EnabledStatusBadge } from "../components/StatusBadge.js";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { NotFoundPanel } from "../components/NotFoundPanel.js";
import { ChannelActivityTab } from "./channel-detail/ChannelActivityTab.js";
import { ChannelDangerZonePanel } from "./channel-detail/ChannelDangerZonePanel.js";
import { ChannelSettingsForm } from "./channel-detail/ChannelSettingsForm.js";
import { ChannelTokensPanel } from "./channel-detail/ChannelTokensPanel.js";
import { EndpointsTab } from "./channel-detail/EndpointsTab.js";

type Tab = "activity" | "endpoints" | "settings";

const TABS: readonly Tab[] = ["activity", "endpoints", "settings"];
const TAB_LABEL: Record<Tab, string> = {
  activity: "Activity",
  endpoints: "Endpoints",
  settings: "Settings",
};

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (TABS as readonly string[]).includes(value);
}

/** True for the admin API's 404 on an unknown or soft-deleted Channel id. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

/**
 * Channel detail (issue #42): the Channel id, active tab, and expanded Broadcast
 * all live in the URL (`/channels/:channelId/:tab?/:broadcastId?`) — a reload or
 * a shared link lands on the exact same view instead of the directory.
 */
export function ChannelDetailPage() {
  const { channelId = "", tab: tabParam, broadcastId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tab: Tab = isTab(tabParam) ? tabParam : "activity";

  const channelQuery = useQuery({
    queryKey: ["channel", channelId] as const,
    queryFn: () => api.getChannel(channelId),
    // ADR 0004 polls this surface ~every 5s, but a 404 is terminal: the Channel
    // was deleted (or never existed) and the view it renders offers no Retry,
    // so keep polling only while the id could still resolve (and only while
    // the tab is visible; see freshnessRefetchInterval).
    refetchInterval: (query) =>
      isNotFound(query.state.error) ? false : freshnessRefetchInterval(),
  });
  useRefetchOnVisible(() => void channelQuery.refetch());

  const channel = channelQuery.data ?? null;
  const notFound = channelQuery.isError && isNotFound(channelQuery.error);
  const error =
    channelQuery.isError && !notFound
      ? queryErrorMessage(channelQuery.error, "Failed to load Channel")
      : null;

  // The not-found view owns its own title (NotFoundPanel).
  useEffect(() => {
    if (channel) {
      document.title = `${channel.slug} · ${TAB_LABEL[tab]} · webhook-broadcast`;
    }
  }, [channel, tab]);

  const goToTab = useCallback(
    (nextTab: Tab) => navigate(`/channels/${channelId}/${nextTab}`),
    [navigate, channelId],
  );

  const toggleBroadcast = useCallback(
    (nextBroadcastId: string) => {
      if (broadcastId === nextBroadcastId) {
        navigate(`/channels/${channelId}/activity`);
      } else {
        navigate(`/channels/${channelId}/activity/${nextBroadcastId}`);
      }
    },
    [navigate, channelId, broadcastId],
  );

  if (notFound) {
    return (
      <NotFoundPanel
        title="Channel not found"
        message="Channel not found. It may have been deleted."
      />
    );
  }

  return (
    <div className="stack">
      <Link to="/" className="button-ghost">
        ← Back to Channels
      </Link>

      {error && <InlineLoadError message={error} onRetry={() => void channelQuery.refetch()} />}
      {!channel && !error && <p className="muted">Loading…</p>}

      {channel && (
        <>
          <header className="channel-header">
            <EnabledStatusBadge enabled={channel.enabled} />
            <h2>{channel.slug}</h2>
            {channel.allowUnauthenticatedIngest && (
              <span
                className="muted"
                title="This Channel accepts POST /ingest without a token. The slug alone gates its fan-out."
              >
                unauthenticated ingest
              </span>
            )}
          </header>

          <nav className="tabs">
            {TABS.map((candidateTab) => (
              <button
                key={candidateTab}
                type="button"
                className={`tab ${tab === candidateTab ? "tab-active" : ""}`}
                onClick={() => goToTab(candidateTab)}
              >
                {TAB_LABEL[candidateTab]}
              </button>
            ))}
          </nav>

          {tab === "activity" && (
            <ChannelActivityTab
              channelId={channelId}
              expandedBroadcastId={broadcastId ?? null}
              onToggleBroadcast={toggleBroadcast}
            />
          )}
          {tab === "endpoints" && <EndpointsTab channelId={channelId} />}
          {tab === "settings" && (
            <>
              <ChannelSettingsForm
                channel={channel}
                onSaved={(updated) => queryClient.setQueryData(["channel", channelId], updated)}
              />
              <ChannelTokensPanel channelId={channelId} />
              <ChannelDangerZonePanel channel={channel} onDeleted={() => navigate("/")} />
            </>
          )}
        </>
      )}
    </div>
  );
}
