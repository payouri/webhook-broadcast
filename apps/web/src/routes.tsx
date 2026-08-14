import { Route, Routes } from "react-router";
import { NotFoundPanel } from "./components/NotFoundPanel.js";
import { ChannelDetailPage } from "./pages/ChannelDetailPage.js";
import { ChannelDirectoryPage } from "./pages/ChannelDirectoryPage.js";

/**
 * The app's one route table (issue #42): the Channel id, active tab, and
 * expanded Broadcast all live in the URL, so a reload or a shared link lands on
 * the exact same view. Exported as a component rather than inlined in `App` so
 * tests exercise this table itself instead of a copy that can drift from it.
 *
 * The `:channelId` segment accepts either a Channel's id (UUID) or its slug
 * (issue #56) — `ChannelDetailPage` resolves whichever one arrives via
 * `useChannelRouteId`, and that one route table covers every nested form (a
 * tab, `?filter=`, an expanded Broadcast) since they all nest under this same
 * segment. See `lib/channelRef.ts` for which form each surface links.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ChannelDirectoryPage />} />
      <Route path="/channels/:channelId/:tab?/:broadcastId?" element={<ChannelDetailPage />} />
      <Route
        path="*"
        element={
          <NotFoundPanel
            title="Page not found"
            message="This address does not match any view. The link may be incomplete."
          />
        }
      />
    </Routes>
  );
}
