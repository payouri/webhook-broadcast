import { useCallback, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, useNavigate } from "react-router";
import { LogOut, Radio } from "lucide-react";
import { api } from "./lib/api.js";
import { useDelayedPending } from "./lib/delayedPending.js";
import { queryClient } from "./lib/queryClient.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AppRoutes } from "./routes.js";
import { ThemeToggle, useAppliedTheme } from "./components/ThemeToggle.js";

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
    <button type="button" className="control" onClick={() => void handleLogout()}>
      <LogOut size={14} strokeWidth={1.75} aria-hidden="true" />
      Log out
    </button>
  );
}

export function App() {
  const [session, setSession] = useState<Session>("checking");
  // Applied above the session branch, so the login page is themed too.
  const [theme, cycleTheme] = useAppliedTheme();

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

  // The session check's own delay-and-hold (DESIGN.md §5): a session check
  // that resolves inside the delay never paints this text at all, and one
  // that does paint it holds for the minimum even if the check resolves
  // sooner.
  const showChecking = useDelayedPending(session === "checking");
  if (showChecking) {
    return <main className="centered muted">Checking session…</main>;
  }

  if (session === "checking") {
    // Still checking, but not shown yet — this is the fast path.
    return null;
  }

  if (session === "loggedOut") {
    return (
      <LoginPage
        onLoggedIn={() => setSession("loggedIn")}
        theme={theme}
        onCycleTheme={cycleTheme}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/*
          The header spans the full width and is sticky; the content column is
          aligned inside it by `.app-header-inner`. The document is the one
          scroll container in the app, so the header scrolls with the page's own
          scrollbar rather than sitting beside a second, inset one.
        */}
        <header className="app-header">
          <div className="app-header-inner">
            {/* Brand, not a heading: persistent chrome present on every route,
                so it stays out of the heading outline and each view supplies
                its own single h1. */}
            <Link to="/" className="app-brand">
              <Radio className="app-brand-mark" size={17} strokeWidth={2} aria-hidden="true" />
              webhook-broadcast
            </Link>
            <div className="app-header-actions">
              <ThemeToggle theme={theme} onCycle={cycleTheme} />
              <LogoutButton onLoggedOut={() => setSession("loggedOut")} />
            </div>
          </div>
        </header>
        <main className="app-main">
          <AppRoutes />
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
