import { useCallback, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, useNavigate } from "react-router";
import { api } from "./lib/api.js";
import { queryClient } from "./lib/queryClient.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AppRoutes } from "./routes.js";

type Session = "checking" | "loggedOut" | "loggedIn";

/** Header logout button: routes back to the directory and clears the session. */
function LogoutButton({ onLoggedOut }: { onLoggedOut: () => void }) {
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    navigate("/", { replace: true });
    onLoggedOut();
  }, [navigate, onLoggedOut]);

  return (
    <button type="button" className="button-ghost" onClick={() => void handleLogout()}>
      Log out
    </button>
  );
}

export function App() {
  const [session, setSession] = useState<Session>("checking");

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

  if (session === "checking") {
    return <main className="centered muted">Loading…</main>;
  }

  if (session === "loggedOut") {
    return <LoginPage onLoggedIn={() => setSession("loggedIn")} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="app-shell">
          <header className="app-header">
            {/* Brand, not a heading (issue #51): each route supplies its own single
                h1 describing that view, so this persistent chrome, present on
                every route, stays out of the heading outline. */}
            <Link to="/" className="link-button app-brand">
              webhook-broadcast
            </Link>
            <LogoutButton onLoggedOut={() => setSession("loggedOut")} />
          </header>
          <main className="app-main">
            <AppRoutes />
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
