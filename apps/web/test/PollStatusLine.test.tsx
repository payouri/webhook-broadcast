// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PollStatusLine } from "../src/components/PollStatusLine.js";
import { derivePollStatus } from "../src/lib/pollStatus.js";

const UPDATED_AT = new Date("2026-08-14T11:55:00.000Z").getTime();

describe("derivePollStatus — issue #54", () => {
  it("is 'unknown' before any fetch has ever succeeded", () => {
    expect(derivePollStatus({ dataUpdatedAt: 0, isError: true })).toEqual({ state: "unknown" });
    expect(derivePollStatus({ dataUpdatedAt: 0, isError: false })).toEqual({ state: "unknown" });
  });

  it("is 'ok' once a fetch has succeeded and the current attempt is not erroring", () => {
    expect(derivePollStatus({ dataUpdatedAt: UPDATED_AT, isError: false })).toEqual({
      state: "ok",
      lastUpdatedAt: UPDATED_AT,
    });
  });

  it("is 'failing' — distinct from a quiet system — once a prior success exists but the poll is erroring", () => {
    expect(derivePollStatus({ dataUpdatedAt: UPDATED_AT, isError: true })).toEqual({
      state: "failing",
      lastUpdatedAt: UPDATED_AT,
    });
  });
});

describe("<PollStatusLine> — last-refreshed and failing-poll states (issue #54)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing before the first successful fetch", () => {
    const { container } = render(<PollStatusLine dataUpdatedAt={0} isError={true} />);
    expect(container.textContent).toBe("");
  });

  it("states when data last refreshed successfully, as a quiet, non-alarming reading", () => {
    render(<PollStatusLine dataUpdatedAt={UPDATED_AT} isError={false} />);
    expect(screen.getByText(/^Updated/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/failing/i)).toBeNull();
  });

  it("names a failing poll distinctly from a quiet system, without escalating past the shared status vocabulary", () => {
    const { container } = render(<PollStatusLine dataUpdatedAt={UPDATED_AT} isError={true} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Updates failing/);
    // Recovery is stated in terms of the last time data *did* arrive, not a
    // blank or an alarm glyph — the same information a healthy poll states.
    expect(container.textContent).toMatch(/showing data from/i);
  });

  it("keeps the ticking elapsed reading out of the live region, so the failure announces once rather than every tick", () => {
    render(<PollStatusLine dataUpdatedAt={UPDATED_AT} isError={true} />);
    const status = screen.getByRole("status");
    // A polite region re-announces whenever its content changes, and the
    // elapsed label changes every 30s: only the fixed sentence lives inside it.
    expect(status.textContent).toBe("Updates failing");
    expect(status.querySelector("time")).toBeNull();
  });

  it("clears the failing state the instant a later fetch succeeds, with no separate action", () => {
    const { rerender } = render(<PollStatusLine dataUpdatedAt={UPDATED_AT} isError={true} />);
    expect(screen.getByRole("status").textContent).toMatch(/Updates failing/);

    const recoveredAt = UPDATED_AT + 5_000;
    rerender(<PollStatusLine dataUpdatedAt={recoveredAt} isError={false} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/^Updated/)).toBeTruthy();
  });
});
