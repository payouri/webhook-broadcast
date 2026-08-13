import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { channelQueryKey, isChannelNotFound, useChannelQuery } from "../lib/channelQuery.js";
import { queryErrorMessage } from "../lib/freshness.js";
import { EnabledStatusBadge } from "../components/StatusBadge.js";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { NotFoundPanel } from "../components/NotFoundPanel.js";
import { ChannelActivityTab } from "./channel-detail/ChannelActivityTab.js";
import { ChannelDangerZonePanel } from "./channel-detail/ChannelDangerZonePanel.js";
import { ChannelSettingsForm } from "./channel-detail/ChannelSettingsForm.js";
import { ChannelTokensPanel } from "./channel-detail/ChannelTokensPanel.js";
import { EndpointsTab } from "./channel-detail/EndpointsTab.js";
import { IngestUrlPanel } from "./channel-detail/IngestUrlPanel.js";

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

/**
 * Channel detail (issue #42): the Channel id, active tab, and expanded Broadcast
 * all live in the URL (`/channels/:channelId/:tab?/:broadcastId?`) — a reload or
 * a shared link lands on the exact same view instead of the directory.
 */
export function ChannelDetailPage() {
  const { channelId = "", tab: tabParam, broadcastId } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const queryClient = useQueryClient();
  const tab: Tab = isTab(tabParam) ? tabParam : "activity";

  const channelQuery = useChannelQuery(channelId);

  const channel = channelQuery.data ?? null;
  const notFound = channelQuery.isError && isChannelNotFound(channelQuery.error);
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

  // Expanding or collapsing a Broadcast stays inside the Activity view, so it
  // carries that view's query string along (issue #51's `?filter=failed`): the
  // drill-down from a failure count to the failing Broadcast is one path, and
  // opening a row must not silently drop back to the unfiltered list.
  const toggleBroadcast = useCallback(
    (nextBroadcastId: string) => {
      const openId = broadcastId === nextBroadcastId ? "" : `/${nextBroadcastId}`;
      navigate(`/channels/${channelId}/activity${openId}${search}`);
    },
    [navigate, channelId, broadcastId, search],
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
            {/* This view's one h1 (issue #51): the Channel slug names the view,
                so it must not sit at the same heading level as the panel
                headings (Activity, Endpoints, Ingest tokens, …) beneath it. */}
            <h1>{channel.slug}</h1>
            {channel.allowUnauthenticatedIngest && (
              // The security-relevant fact this tag names lives in visible text
              // below (IngestUrlPanel), not only in a `title` attribute (issue
              // #51): a `title` is invisible to keyboard/touch and inconsistently
              // announced by screen readers. `aria-describedby` links the two for
              // assistive tech that supports it, on top of plain reading order.
              <span className="muted" aria-describedby="unauthenticated-ingest-note">
                unauthenticated ingest
              </span>
            )}
          </header>

          <IngestUrlPanel channel={channel} />

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
                onSaved={(updated) => queryClient.setQueryData(channelQueryKey(channelId), updated)}
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
