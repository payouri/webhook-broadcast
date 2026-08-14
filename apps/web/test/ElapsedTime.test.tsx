// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElapsedTime } from "../src/components/ElapsedTime.js";
import { formatAbsolute, formatElapsed } from "../src/lib/relativeTime.js";

const NOW = new Date("2026-08-14T12:00:00.000Z").getTime();

describe("formatElapsed — issue #54", () => {
  it("reads recent instants as 'just now'", () => {
    expect(formatElapsed(new Date(NOW - 3_000).toISOString(), NOW)).toBe("just now");
  });

  it("counts seconds, minutes, hours, and days as the gap grows", () => {
    expect(formatElapsed(new Date(NOW - 45_000).toISOString(), NOW)).toBe("45s ago");
    expect(formatElapsed(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m ago");
    expect(formatElapsed(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3h ago");
    expect(formatElapsed(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe("2d ago");
  });

  it("folds a future timestamp (clock skew) into 'just now' instead of a negative duration", () => {
    expect(formatElapsed(new Date(NOW + 30_000).toISOString(), NOW)).toBe("just now");
  });
});

describe("<ElapsedTime> — reads as elapsed, keeps the exact instant reachable (issue #54)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the elapsed reading, with the exact instant in the markup and reachable by keyboard", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    render(<ElapsedTime iso={iso} />);

    const time = screen.getByText("5m ago");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe(iso);
    // Reachable by keyboard and touch — not gated behind a mouse-only hover:
    // a real tab stop, not merely a `title` attribute nobody can tab to.
    expect(time.getAttribute("tabIndex")).toBe("0");
    // The exact instant is present in the DOM (not hover-only), even though
    // its visibility is toggled by CSS on `:hover`/`:focus`.
    expect(time.textContent).toContain(formatAbsolute(iso));
    // ...and announced, not only shown: the description points at the bubble,
    // which counts toward the description even while CSS keeps it hidden.
    const describedBy = time.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const bubble = time.querySelector("[role='tooltip']");
    expect(bubble?.id).toBe(describedBy);
    expect(bubble?.textContent).toBe(formatAbsolute(iso));

    vi.useRealTimers();
  });

  it("takes no tab stop of its own inside an interactive row, where the row already owns one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    render(
      <button type="button" className="row">
        <ElapsedTime iso={iso} focusable={false} />
      </button>,
    );

    const time = screen.getByText(/5m ago/).closest("time");
    // A focusable descendant of a `<button>` is a nested interactive control:
    // the button's content is flattened for assistive tech, and it costs an
    // extra Tab press per row. The row's own focus reveals the bubble instead
    // (`.row:focus-visible .elapsed-time-exact`).
    expect(time?.getAttribute("tabIndex")).toBeNull();
    expect(time?.getAttribute("aria-describedby")).toBeNull();
    // The bubble is decoration here, so it stays out of the row's name.
    const bubble = time?.querySelector(".elapsed-time-exact");
    expect(bubble?.getAttribute("aria-hidden")).toBe("true");
    expect(bubble?.textContent).toBe(formatAbsolute(iso));

    vi.useRealTimers();
  });

  it("advances the label as time passes, without a manual refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(NOW).toISOString();
    render(<ElapsedTime iso={iso} />);

    expect(screen.getByText("just now")).toBeTruthy();

    act(() => {
      vi.setSystemTime(NOW + 5 * 60_000);
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("5m ago")).toBeTruthy();
  });

  it("shares one clock across many instances (no per-row timer storm)", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    vi.setSystemTime(NOW);
    const iso = new Date(NOW).toISOString();

    render(
      <>
        <ElapsedTime iso={iso} />
        <ElapsedTime iso={iso} />
        <ElapsedTime iso={iso} />
      </>,
    );

    // One shared tick, not one per mounted `ElapsedTime`.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
