import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Activity, ArrowLeft, Plug, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Channel } from "@webhook-broadcast/contract";
import {
  channelQueryKey,
  channelSlugLookupKey,
  isUnresolvableChannelRoute,
  useChannelQuery,
  useChannelRouteId,
} from "../lib/channelQuery.js";
import { queryErrorMessage } from "../lib/freshness.js";
import { EnabledStatusLamp } from "../components/StatusLamp.js";
import { InlineLoadError } from "../components/InlineLoadError.js";
import { NotFoundPanel } from "../components/NotFoundPanel.js";
import { SkeletonRows } from "../components/SkeletonRows.js";
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
/* One glyph per tab, so the strip is recognizable by shape before it is read:
   a signal trace for Activity, a patch plug for Endpoints, faders for Settings. */
const TAB_ICON: Record<Tab, LucideIcon> = {
  activity: Activity,
  endpoints: Plug,
  settings: SlidersHorizontal,
};

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (TABS as readonly string[]).includes(value);
}

/**
 * Channel detail (issue #42): the Channel id, active tab, and expanded Broadcast
 * all live in the URL (`/channels/:channelId/:tab?/:broadcastId?`) — a reload or
 * a shared link lands on the exact same view instead of the directory.
 *
 * Issue #56: that first segment is either a Channel id or its slug (see
 * `channelRef.ts` for the rule on which form each surface uses). This page
 * never rewrites whichever form the operator arrived with — `routeChannelId`
 * stays in every navigation this page builds — and resolves it to the real id
 * (`channelId`) that every nested query and mutation requires. Its one
 * exception is `followSlugRename`, which substitutes a live slug for the dead
 * one an operator just renamed away from; the form is still never switched.
 */
export function ChannelDetailPage() {
  const { channelId: routeChannelId = "", tab: tabParam, broadcastId } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const queryClient = useQueryClient();
  const tab: Tab = isTab(tabParam) ? tabParam : "activity";

  const {
    channelId,
    isSlugNotFound,
    error: slugLookupError,
    retry: retrySlugLookup,
  } = useChannelRouteId(routeChannelId);
  const channelQuery = useChannelQuery(channelId ?? "", { enabled: channelId !== undefined });

  const channel = channelQuery.data ?? null;
  const notFound =
    isSlugNotFound || (channelQuery.isError && isUnresolvableChannelRoute(channelQuery.error));
  // Two fetches can fail on the way to this view — resolving a slug segment to
  // an id, then loading the Channel — and whichever failed owns the Retry.
  const failure =
    slugLookupError ?? (channelQuery.isError && !notFound ? channelQuery.error : null);
  const error = failure ? queryErrorMessage(failure, "Failed to load Channel") : null;
  const retryLoad = slugLookupError ? retrySlugLookup : () => void channelQuery.refetch();

  // The not-found view owns its own title (NotFoundPanel).
  useEffect(() => {
    if (channel) {
      document.title = `${channel.slug} · ${TAB_LABEL[tab]} · webhook-broadcast`;
    }
  }, [channel, tab]);

  /*
   * A slug rename retires the slug this page may itself be addressed by. Left
   * alone, the very page doing the renaming would flip to "Channel not found"
   * the moment its slug lookup next ran, so the route follows the Channel to
   * its new slug. That moves the *value* in the address bar, never the form:
   * an id-form route holds a reference a rename cannot invalidate and is left
   * exactly as the operator typed it (see `lib/channelRef.ts`). Links already
   * shared under the old slug still die — that is the consequence stated at
   * the slug field itself, and only a redirect table could undo it.
   */
  const followSlugRename = useCallback(
    (previousSlug: string, updated: Channel) => {
      if (routeChannelId !== previousSlug || updated.slug === previousSlug) {
        return;
      }
      // Seed the new slug's lookup so the route change resolves from cache: an
      // unseeded hop would blank this page back to its skeleton for one request
      // immediately after a save. The old slug's entry is left to go inactive
      // and expire on its own rather than removed — removing it while this page
      // still observes it forces one last refetch under the old value.
      queryClient.setQueryData(channelSlugLookupKey(updated.slug), updated);
      navigate(`/channels/${updated.slug}/settings`, { replace: true });
    },
    [navigate, queryClient, routeChannelId],
  );

  // Expanding or collapsing a Broadcast stays inside the Activity view, so it
  // carries that view's query string along (issue #51's `?filter=failed`): the
  // drill-down from a failure count to the failing Broadcast is one path, and
  // opening a row must not silently drop back to the unfiltered list.
  const toggleBroadcast = useCallback(
    (nextBroadcastId: string) => {
      const openId = broadcastId === nextBroadcastId ? "" : `/${nextBroadcastId}`;
      navigate(`/channels/${routeChannelId}/activity${openId}${search}`);
    },
    [navigate, routeChannelId, broadcastId, search],
  );

  if (notFound) {
    return (
      // One message for all four ways this address fails to name a Channel: an
      // unknown id, a soft-deleted one, a slug nobody holds any more, and an id
      // the API rejects outright (issue #57). "It may have been deleted" alone
      // read as a fact about a Channel that, for a mistyped address, never
      // existed — so the copy names both possibilities and asserts neither.
      <NotFoundPanel
        title="Channel not found"
        message="Channel not found. It may have been deleted, or the link may be wrong."
      />
    );
  }

  return (
    <div className="stack">
      {/* Wrapped, so the control is sized by its own label rather than stretched
          to the column width by the stack's cross-axis stretch. */}
      <div className="back-bar">
        <Link to="/" className="control">
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Back to Channels
        </Link>
      </div>

      {error && <InlineLoadError message={error} onRetry={retryLoad} />}
      {!channel && !error && <SkeletonRows count={2} label="Loading Channel" />}

      {channel && (
        <>
          <header className="channel-header">
            <EnabledStatusLamp enabled={channel.enabled} />
            {/* This view's one h1: the Channel slug names the view, so it must
                not sit at the same heading level as the legends beneath it. */}
            <h1>{channel.slug}</h1>
            {channel.allowUnauthenticatedIngest && (
              // The security-relevant fact this tag names lives in visible text
              // below (IngestUrlPanel), not only in a `title` attribute: a
              // `title` is invisible to keyboard/touch and inconsistently
              // announced by screen readers. `aria-describedby` links the two
              // for assistive tech that supports it, on top of reading order.
              <span className="muted" aria-describedby="unauthenticated-ingest-note">
                unauthenticated ingest
              </span>
            )}
          </header>

          <IngestUrlPanel channel={channel} />

          <nav className="tabs">
            {TABS.map((candidateTab) => {
              const Glyph = TAB_ICON[candidateTab];
              const active = tab === candidateTab;
              return (
                // A tab that changes the URL is a navigation control, not a
                // button that happens to look like one: an `<a>` gets
                // cmd-click, middle-click, "open in new tab", and "copy link
                // address" for free, none of which a `<button>` can offer no
                // matter how it is styled (DESIGN.md's "what it does decides
                // what it is"). `aria-current="page"` carries the selected
                // state for assistive tech the same way `.tab-active` carries
                // it visually, since a link has no notion of "active" of its
                // own.
                <Link
                  key={candidateTab}
                  to={`/channels/${routeChannelId}/${candidateTab}`}
                  className={`tab ${active ? "tab-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Glyph size={13} strokeWidth={2} aria-hidden="true" />
                  {TAB_LABEL[candidateTab]}
                </Link>
              );
            })}
          </nav>

          {tab === "activity" && (
            <ChannelActivityTab
              channelId={channel.id}
              channelSlug={channel.slug}
              expandedBroadcastId={broadcastId ?? null}
              onToggleBroadcast={toggleBroadcast}
            />
          )}
          {tab === "endpoints" && <EndpointsTab channelId={channel.id} />}
          {tab === "settings" && (
            /*
             * Two columns on a wide viewport. The plates here are prose- and
             * field-shaped, so each caps well short of the content column, and
             * stacking all three left a third of the page as abandoned ground.
             * The split is also a real grouping: what the Channel *is* on the
             * left, what grants access to it and what destroys it on the right.
             * Collapses to one column below 1000px.
             */
            <div className="settings-grid">
              <ChannelSettingsForm
                channel={channel}
                onSaved={(updated) => {
                  queryClient.setQueryData(channelQueryKey(channel.id), updated);
                  followSlugRename(channel.slug, updated);
                }}
              />
              <div className="stack">
                <ChannelTokensPanel channelId={channel.id} />
                <ChannelDangerZonePanel channel={channel} onDeleted={() => navigate("/")} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
