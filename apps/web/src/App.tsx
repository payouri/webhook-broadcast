import { useCallback, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { api } from "./lib/api.js";
import { queryClient } from "./lib/queryClient.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ChannelDirectoryPage } from "./pages/ChannelDirectoryPage.js";
import { ChannelDetailPage } from "./pages/ChannelDetailPage.js";

type Session = "checking" | "loggedOut" | "loggedIn";
type Route = { name: "directory" } | { name: "channel"; channelId: string };

export function App() {
  const [session, setSession] = useState<Session>("checking");
  const [route, setRoute] = useState<Route>({ name: "directory" });

  const checkSession = useCallback(async () => {
    try {
      await api.session();
      setSession("loggedIn");
    } catch {
      setSession("loggedOut");
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSession("loggedOut");
    setRoute({ name: "directory" });
  }, []);

  if (session === "checking") {
    return <main className="centered muted">Loading…</main>;
  }

  if (session === "loggedOut") {
    return <LoginPage onLoggedIn={() => setSession("loggedIn")} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        <header className="app-header">
          <button
            type="button"
            className="link-button"
            onClick={() => setRoute({ name: "directory" })}
          >
            <h1>webhook-broadcast</h1>
          </button>
          <button type="button" className="button-ghost" onClick={() => void handleLogout()}>
            Log out
          </button>
        </header>
        <main className="app-main">
          {route.name === "directory" ? (
            <ChannelDirectoryPage
              onOpenChannel={(channelId) => setRoute({ name: "channel", channelId })}
            />
          ) : (
            <ChannelDetailPage
              channelId={route.channelId}
              onBack={() => setRoute({ name: "directory" })}
            />
          )}
        </main>
      </div>
    </QueryClientProvider>
  );
}
