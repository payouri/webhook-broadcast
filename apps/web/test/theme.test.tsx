// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import INDEX_HTML from "../index.html?raw";
import { STORAGE_KEY, ThemeToggle, useAppliedTheme } from "../src/components/ThemeToggle.js";

/**
 * The pre-paint script in `index.html` is the one piece of theme logic that
 * cannot be imported: it has to run before any bundle exists to import from.
 * These tests hold it to the same three-state model the toggle implements, and
 * — the reason this file exists — fail if its copy of the storage key ever
 * drifts from `STORAGE_KEY`.
 */
/** The first classic (non-module) script in the document — the pre-paint one. */
function prePaintScriptSource(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML);
  if (!match?.[1]) {
    throw new Error("No inline pre-paint script found in apps/web/index.html.");
  }
  return match[1];
}

/** Storage that fails the way a blocked or private-mode store does. */
const BLOCKED = Symbol("blocked storage");

/**
 * Runs the script's real source against the current document, with `stored`
 * standing in for what is under `STORAGE_KEY`.
 *
 * Storage is supplied as a parameter rather than read off the global for two
 * reasons: jsdom's `localStorage` is shadowed here by Node's own inert one
 * (which wants `--localstorage-file`), and a stub is the only honest way to
 * reach the blocked-storage branch. The script's own text is untouched — a
 * lookup under any key but `STORAGE_KEY` comes back empty, so a drifted key
 * fails the stamping tests below and not merely the literal one.
 */
function runPrePaintScript(stored: string | null | typeof BLOCKED = null): void {
  const localStorage = {
    getItem(key: string): string | null {
      if (stored === BLOCKED) {
        throw new Error("SecurityError: storage is blocked");
      }
      return key === STORAGE_KEY ? stored : null;
    },
  };
  new Function("localStorage", prePaintScriptSource())(localStorage);
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe("the pre-paint theme script", () => {
  it("reads the same storage key the toggle writes", () => {
    // A literal match, because the script cannot import the constant.
    expect(prePaintScriptSource()).toContain(JSON.stringify(STORAGE_KEY));
  });

  it("runs ahead of the bundle, from the head", () => {
    // Order is the whole point: a stamp applied after the module would be a
    // stamp applied after first paint, which is the bug this fixes.
    const prePaint = INDEX_HTML.indexOf("<script>");
    const bundle = INDEX_HTML.indexOf('<script type="module"');
    expect(prePaint).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(prePaint);

    // "From the head" is the other half of the claim: a script placed in the
    // body would still precede the module bundle and still paint late.
    const headEnd = INDEX_HTML.indexOf("</head>");
    expect(headEnd).toBeGreaterThan(-1);
    expect(prePaint).toBeLessThan(headEnd);
  });

  it.each(["dark", "light"] as const)("stamps a forced %s theme", (theme) => {
    runPrePaintScript(theme);

    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it("leaves the root unstamped on the system setting, so prefers-color-scheme decides", () => {
    runPrePaintScript("system");

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("leaves the root unstamped when nothing has been chosen yet", () => {
    runPrePaintScript(null);

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("ignores a stored value outside the three-state model", () => {
    runPrePaintScript("midnight");

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("degrades to the OS preference when storage is blocked, without throwing", () => {
    expect(() => {
      runPrePaintScript(BLOCKED);
    }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

function ThemeHarness() {
  const [theme, cycle] = useAppliedTheme();
  return <ThemeToggle theme={theme} onCycle={cycle} />;
}

/**
 * The other half of the contract: once React mounts it owns the stamp, and the
 * pre-paint script must not have left anything behind that stops the toggle
 * moving. jsdom here has no working storage, so this doubles as the blocked-
 * storage case on the React side — the preference is session-only and the
 * control still works, which is what the toggle promises.
 */
describe("the toggle after mount", () => {
  it("cycles system to light to dark and back, stamping the root each time", () => {
    render(<ThemeHarness />);
    const button = () => screen.getByRole("button");

    // `system` stamps nothing, leaving prefers-color-scheme in charge.
    expect(document.documentElement.dataset.theme).toBeUndefined();

    fireEvent.click(button());
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(button());
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(button());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("keeps its accessible name in step with the state it is in", () => {
    render(<ThemeHarness />);
    // Looked up by name, so a label left behind on the previous state fails here.
    const byName = (name: string) => screen.getByRole("button", { name });

    fireEvent.click(byName("Theme: following system. Switch to light."));
    fireEvent.click(byName("Theme: light. Switch to dark."));

    expect(byName("Theme: dark. Switch to following system.")).toBeDefined();
  });
});
