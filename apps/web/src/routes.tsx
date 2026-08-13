import { Route, Routes } from "react-router";
import { NotFoundPanel } from "./components/NotFoundPanel.js";
import { ChannelDetailPage } from "./pages/ChannelDetailPage.js";
import { ChannelDirectoryPage } from "./pages/ChannelDirectoryPage.js";

/**
 * The app's one route table (issue #42): the Channel id, active tab, and
 * expanded Broadcast all live in the URL, so a reload or a shared link lands on
 * the exact same view. Exported as a component rather than inlined in `App` so
 * tests exercise this table itself instead of a copy that can drift from it.
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
            message="This address does not match any view — the link may be incomplete."
          />
        }
      />
    </Routes>
  );
}
