import { useCallback, useEffect, useState } from "react";
import type { Channel } from "@webhook-broadcast/contract";
import { api } from "../lib/api.js";
import { ChannelActivityTab } from "./channel-detail/ChannelActivityTab.js";
import { ChannelDangerZonePanel } from "./channel-detail/ChannelDangerZonePanel.js";
import { ChannelSettingsForm } from "./channel-detail/ChannelSettingsForm.js";
import { ChannelTokensPanel } from "./channel-detail/ChannelTokensPanel.js";
import { EndpointsTab } from "./channel-detail/EndpointsTab.js";

type Tab = "activity" | "endpoints" | "settings";

export function ChannelDetailPage({
  channelId,
  onBack,
}: {
  channelId: string;
  onBack: () => void;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activity");

  const load = useCallback(async () => {
    try {
      const result = await api.getChannel(channelId);
      setChannel(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Channel");
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <button type="button" className="button-ghost" onClick={onBack}>
        ← Back to Channels
      </button>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!channel && !error && <p className="muted">Loading…</p>}

      {channel && (
        <>
          <header className="channel-header">
            <span className={`status-dot ${channel.enabled ? "status-on" : "status-off"}`} />
            <h2>{channel.slug}</h2>
            {channel.allowUnauthenticatedIngest && (
              <span
                className="muted"
                title="This Channel accepts POST /ingest without a token — the slug alone gates its fan-out."
              >
                unauthenticated ingest
              </span>
            )}
          </header>

          <nav className="tabs">
            <button
              type="button"
              className={`tab ${tab === "activity" ? "tab-active" : ""}`}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
            <button
              type="button"
              className={`tab ${tab === "endpoints" ? "tab-active" : ""}`}
              onClick={() => setTab("endpoints")}
            >
              Endpoints
            </button>
            <button
              type="button"
              className={`tab ${tab === "settings" ? "tab-active" : ""}`}
              onClick={() => setTab("settings")}
            >
              Settings
            </button>
          </nav>

          {tab === "activity" && <ChannelActivityTab channelId={channelId} />}
          {tab === "endpoints" && <EndpointsTab channelId={channelId} />}
          {tab === "settings" && (
            <>
              <ChannelSettingsForm channel={channel} onSaved={setChannel} />
              <ChannelTokensPanel channelId={channelId} />
              <ChannelDangerZonePanel channel={channel} onDeleted={onBack} />
            </>
          )}
        </>
      )}
    </div>
  );
}
