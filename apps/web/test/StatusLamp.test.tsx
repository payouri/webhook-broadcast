// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryStatus } from "@webhook-broadcast/contract";
import {
  BroadcastFanoutLamp,
  ChannelHealthLamp,
  DeliveryStatusLamp,
  EnabledStatusLamp,
  StatusLamp,
} from "../src/components/StatusLamp.js";

/** CONTEXT.md's Delivery lifecycle, and the label each status is shown as. */
const DELIVERY_STATUS_LABELS: Array<[DeliveryStatus, string]> = [
  ["pending", "pending"],
  ["in_progress", "in progress"],
  ["succeeded", "succeeded"],
  ["failed", "failed"],
  ["dead_lettered", "dead lettered"],
];

/**
 * Single status vocabulary (issue #43): every status carries a readable text
 * label, so these assertions read the label text — never a color/class —
 * and check that `pending` vs `in_progress` differ in form (hollow vs lit),
 * not merely in color.
 */
describe("StatusLamp — one status vocabulary, never color alone", () => {
  afterEach(() => {
    cleanup();
  });

  it("always renders the label as visible text", () => {
    render(<StatusLamp label="Enabled" tone="live" form="lit" glyph="ok" />);
    expect(screen.getByText("Enabled")).toBeTruthy();
  });

  it("carries a glyph alongside the label, so shape is a third non-color carrier", () => {
    // Form (lit vs hollow) and color are the other two. The glyph is what keeps
    // two same-tone, same-form states distinguishable at a glance.
    const { container } = render(<StatusLamp label="Enabled" tone="live" form="lit" glyph="ok" />);
    expect(container.querySelector(".lamp-glass svg")).toBeTruthy();
  });

  it("labels Channel/Endpoint enabled state in words, not only a color dot", () => {
    render(<EnabledStatusLamp enabled={true} />);
    expect(screen.getByText("Enabled")).toBeTruthy();

    cleanup();
    render(<EnabledStatusLamp enabled={false} />);
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("labels an auto-disabled Endpoint distinctly from a manually disabled one", () => {
    render(<EnabledStatusLamp enabled={false} autoDisabledAt="2026-08-10T12:00:00.000Z" />);
    expect(screen.getByText("Auto-disabled")).toBeTruthy();
  });

  it("labels every Delivery status in the domain's own words", () => {
    for (const [status, label] of DELIVERY_STATUS_LABELS) {
      cleanup();
      render(<DeliveryStatusLamp status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("gives `pending` and `in_progress` different form classes, not just color", () => {
    render(<DeliveryStatusLamp status="pending" />);
    const pending = screen.getByText("pending");
    expect(pending.className).toContain("lamp-hollow");
    expect(pending.className).not.toContain("lamp-lit");
    cleanup();

    render(<DeliveryStatusLamp status="in_progress" />);
    const inProgress = screen.getByText("in progress");
    expect(inProgress.className).toContain("lamp-lit");
    expect(inProgress.className).not.toContain("lamp-hollow");
  });

  it("draws every Delivery status from DESIGN.md's status tones and no others", () => {
    // DESIGN.md keeps Lamp Live and Lamp Cut as the only saturated colors
    // permitted outside the accent and declares a secondary accent deliberately
    // absent, so these three tones are the whole vocabulary — and none of them
    // is the interface accent, which under the One Voice Rule may only ever mean
    // "the operator did this or chose this". A status that reached for a fourth
    // tone fails here.
    const TONES = ["lamp-live", "lamp-neutral", "lamp-cut"];
    for (const [status, label] of DELIVERY_STATUS_LABELS) {
      cleanup();
      render(<DeliveryStatusLamp status={status} />);
      const tones = [...screen.getByText(label).classList].filter((name) => TONES.includes(name));
      expect(tones).toHaveLength(1);
    }
  });

  describe("BroadcastFanoutLamp — the Broadcast row's status stamp (2026-08-13 critique, issue #49)", () => {
    it("reads neutral, naming 'No Endpoints', when the Channel had none enabled", () => {
      render(
        <BroadcastFanoutLamp
          fanout={{ total: 0, succeeded: 0, failed: 0, deadLettered: 0, pending: 0 }}
        />,
      );
      const badge = screen.getByText("No Endpoints");
      expect(badge.className).toContain("lamp-neutral");
      expect(badge.className).toContain("lamp-hollow");
    });

    it("reads Signal Cut, naming the dead-lettered count and the success ratio, when any Delivery dead-lettered", () => {
      render(
        <BroadcastFanoutLamp
          fanout={{ total: 3, succeeded: 1, failed: 1, deadLettered: 1, pending: 0 }}
        />,
      );
      const badge = screen.getByText("1 dead-lettered, 1/3 succeeded");
      expect(badge.className).toContain("lamp-cut");
      expect(badge.className).toContain("lamp-lit");
    });

    it("reads Signal Live, naming the succeeded count, once fan-out has Endpoints and nothing dead-lettered", () => {
      render(
        <BroadcastFanoutLamp
          fanout={{ total: 2, succeeded: 2, failed: 0, deadLettered: 0, pending: 0 }}
        />,
      );
      const badge = screen.getByText("2/2 succeeded");
      expect(badge.className).toContain("lamp-live");
      expect(badge.className).toContain("lamp-lit");
    });

    it("reads Cut for a failed Delivery, which is terminal and never retried", () => {
      // A non-retryable outcome finishes the Delivery as `failed` without ever
      // retrying it (ADR 0003), so this is not work in progress: it is a
      // terminal failure, and DESIGN.md's Lamps table already assigns `failed`
      // to Cut. It must match the red `FAILED` lamp on the Delivery row
      // underneath it rather than contradicting it. The label names the failed
      // count, so an operator on the failures-only filter never has to subtract
      // to find the row they came for.
      render(
        <BroadcastFanoutLamp
          fanout={{ total: 2, succeeded: 1, failed: 1, deadLettered: 0, pending: 0 }}
        />,
      );
      const badge = screen.getByText("1 failed, 1/2 succeeded");
      expect(badge.className).toContain("lamp-cut");
      expect(badge.className).toContain("lamp-lit");
      expect(badge.className).not.toContain("lamp-live");
    });

    it("keeps the cross and the slash apart so Cut is still readable without color", () => {
      // Both are terminal and both are Cut, so the glyph is what separates a
      // non-retryable failure from a spent retry budget.
      const { container: failedBox } = render(
        <BroadcastFanoutLamp
          fanout={{ total: 2, succeeded: 1, failed: 1, deadLettered: 0, pending: 0 }}
        />,
      );
      const { container: deadBox } = render(
        <BroadcastFanoutLamp
          fanout={{ total: 2, succeeded: 1, failed: 0, deadLettered: 1, pending: 0 }}
        />,
      );
      const glyphOf = (box: HTMLElement) => box.querySelector(".lamp-glass svg")?.outerHTML;
      expect(glyphOf(failedBox)).toBeTruthy();
      expect(glyphOf(deadBox)).toBeTruthy();
      expect(glyphOf(failedBox)).not.toEqual(glyphOf(deadBox));
    });

    it("reads neutral and lit while Deliveries are still pending", () => {
      // The one branch that genuinely has work outstanding. Calling an
      // unfinished fan-out "succeeded" would be the same lie the green
      // fallthrough told, in a quieter key.
      render(
        <BroadcastFanoutLamp
          fanout={{ total: 3, succeeded: 1, failed: 0, deadLettered: 0, pending: 2 }}
        />,
      );
      const badge = screen.getByText("2 pending, 1/3 succeeded");
      expect(badge.className).toContain("lamp-neutral");
      expect(badge.className).toContain("lamp-lit");
      expect(badge.className).not.toContain("lamp-live");
    });
  });

  describe("ChannelHealthLamp — issues #44 and #45 directory health signal", () => {
    it("reads as 'no activity' rather than healthy for a Channel with no Broadcasts", () => {
      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={false}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={0}
        />,
      );
      const badge = screen.getByText("No activity");
      expect(badge.className).toContain("lamp-neutral");
      expect(badge.className).toContain("lamp-hollow");
    });

    it("labels zero recent failures as healthy, distinct in text and tone from a failing Channel", () => {
      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={0}
        />,
      );
      const healthy = screen.getByText("No failures (24h)");
      expect(healthy.className).toContain("lamp-live");
      expect(healthy.className).toContain("lamp-lit");
      cleanup();

      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={3}
          autoDisabledEndpointCount={0}
        />,
      );
      const failing = screen.getByText("3 failing (24h)");
      expect(failing.className).toContain("lamp-cut");
      expect(failing.className).toContain("lamp-lit");
    });

    it("carries the failure count in its text, not only in color", () => {
      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={7}
          autoDisabledEndpointCount={0}
        />,
      );
      expect(screen.getByText("7 failing (24h)")).toBeTruthy();
    });

    it("names a non-zero auto-disabled Endpoint count using the shared vocabulary (issue #45)", () => {
      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={2}
        />,
      );
      const badge = screen.getByText("2 auto-disabled");
      expect(badge.className).toContain("lamp-cut");
      expect(badge.className).toContain("lamp-lit");
    });

    it("combines both facts when a Channel has recent failures and an auto-disabled Endpoint", () => {
      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={2}
          autoDisabledEndpointCount={1}
        />,
      );
      expect(screen.getByText("2 failing (24h) · 1 auto-disabled")).toBeTruthy();
    });

    it("never renders the broken (danger) tone for a disabled Channel, even with the same counts", () => {
      // Disabled is a choice, broken is not (issue #45 AC) — a Channel the
      // operator has turned off must read distinctly from one that is
      // actively failing, even while it still carries stale counts from
      // before it was disabled.
      render(
        <ChannelHealthLamp
          enabled={false}
          hasBroadcasts={true}
          recentFailedDeliveryCount={2}
          autoDisabledEndpointCount={1}
        />,
      );
      const badge = screen.getByText("2 failing (24h) · 1 auto-disabled");
      expect(badge.className).toContain("lamp-neutral");
      expect(badge.className).toContain("lamp-hollow");
      expect(badge.className).not.toContain("lamp-cut");
    });

    it("still names an auto-disabled Endpoint once the Channel's Broadcasts have aged out of retention", () => {
      // Only an operator clears `autoDisabledAt` (ADR 0003), but the retention
      // sweeper deletes Broadcasts after HISTORY_RETENTION_DAYS (ADR 0002), so
      // `hasBroadcasts` can fall back to false while an Endpoint is still
      // auto-disabled. `listChannels` ranks that Channel first; the badge must
      // not then read "No activity" and hide the very fact issue #45 surfaces.
      render(
        <ChannelHealthLamp
          enabled={true}
          hasBroadcasts={false}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={1}
        />,
      );
      const badge = screen.getByText("1 auto-disabled");
      expect(badge.className).toContain("lamp-cut");
      expect(screen.queryByText("No activity")).toBeNull();
    });
  });
});
