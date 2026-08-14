// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PENDING_DELAY_MS, PENDING_HOLD_MS, useDelayedPending } from "../src/lib/delayedPending.js";

function Probe({ isPending }: { isPending: boolean }) {
  const visible = useDelayedPending(isPending);
  return <span>{visible ? "shown" : "hidden"}</span>;
}

describe("useDelayedPending — DESIGN.md §5's No-Flicker Rule (issue #77)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("never shows when the wait resolves before the delay elapses", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe isPending={true} />);
    expect(screen.getByText("hidden")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS - 10);
    });
    rerender(<Probe isPending={false} />);

    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS + PENDING_HOLD_MS);
    });
    expect(screen.getByText("hidden")).toBeTruthy();
  });

  it("shows once the delay elapses while still pending, and holds through PENDING_HOLD_MS", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe isPending={true} />);

    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });
    expect(screen.getByText("shown")).toBeTruthy();

    // The wait resolves immediately after being shown — the hold keeps it on
    // screen rather than letting it vanish the next frame.
    rerender(<Probe isPending={false} />);
    expect(screen.getByText("shown")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(PENDING_HOLD_MS - 10);
    });
    expect(screen.getByText("shown")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByText("hidden")).toBeTruthy();
  });

  it("keeps showing for as long as the wait is still genuinely in flight, however long that is", () => {
    vi.useFakeTimers();
    render(<Probe isPending={true} />);

    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS);
    });
    expect(screen.getByText("shown")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(PENDING_HOLD_MS + 500);
    });
    // Still pending the whole time: still shown, no forced hide once the
    // hold's minimum has passed — the hold is a floor, not a ceiling.
    expect(screen.getByText("shown")).toBeTruthy();
  });

  it("hides as soon as the wait resolves once the hold's minimum has already elapsed", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe isPending={true} />);

    act(() => {
      vi.advanceTimersByTime(PENDING_DELAY_MS + PENDING_HOLD_MS + 500);
    });
    expect(screen.getByText("shown")).toBeTruthy();

    rerender(<Probe isPending={false} />);
    expect(screen.getByText("hidden")).toBeTruthy();
  });
});
