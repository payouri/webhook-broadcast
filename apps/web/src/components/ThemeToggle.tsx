import { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

/**
 * Theme selection. Three states, because "follow the OS" is a real answer and
 * not the absence of one: `system` leaves the root element unstamped and lets
 * `prefers-color-scheme` decide, while `light` and `dark` stamp `data-theme` and
 * win over it in both directions.
 *
 * This lives in the header rather than in Settings: it is a viewing preference
 * of this browser, not Channel configuration, and Settings is where facts about
 * the Channel are edited.
 */
type Theme = "system" | "light" | "dark";

/**
 * The one key the preference is read from and written to. The pre-paint script
 * in `apps/web/index.html` has to repeat this literal — it runs before any
 * bundle exists to import from — so it is exported here and the agreement is
 * held by `test/theme.test.tsx` rather than by memory.
 */
export const STORAGE_KEY = "webhook-broadcast:theme";
const ORDER: readonly Theme[] = ["system", "light", "dark"];

const NEXT_LABEL: Record<Theme, string> = {
  system: "Theme: following system. Switch to light.",
  light: "Theme: light. Switch to dark.",
  dark: "Theme: dark. Switch to following system.",
};

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    // Private-mode or blocked storage: the OS preference is a fine default and
    // the control still works for this session.
    return "system";
  }
}

function applyTheme(theme: Theme): void {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

/** Applies the stored theme on mount. Called once, above the session branch, so
 *  it covers the login page as well as the app shell. */
export function useAppliedTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference is session-only when storage is unavailable.
    }
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] as Theme);
  }, []);

  return [theme, cycle];
}

const GLYPH: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function ThemeToggle({ theme, onCycle }: { theme: Theme; onCycle: () => void }) {
  const Glyph = GLYPH[theme];
  return (
    <button
      type="button"
      className="control control-icon"
      onClick={onCycle}
      /* The full state and the consequence of pressing, because the glyph alone
         cannot say which of the three the surface is currently in. */
      aria-label={NEXT_LABEL[theme]}
      title={NEXT_LABEL[theme]}
    >
      <Glyph className="control-icon-glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
