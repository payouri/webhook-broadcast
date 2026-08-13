// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryStatus } from "@webhook-broadcast/contract";
import {
  ChannelHealthBadge,
  DeliveryStatusBadge,
  EnabledStatusBadge,
  StatusBadge,
} from "../src/components/StatusBadge.js";

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
 * and check that `pending` vs `in_progress` differ in form (outline vs
 * filled), not merely in color.
 */
describe("StatusBadge — one status vocabulary, never color alone", () => {
  afterEach(() => {
    cleanup();
  });

  it("always renders the label as visible text", () => {
    render(<StatusBadge label="Enabled" tone="success" form="filled" />);
    expect(screen.getByText("Enabled")).toBeTruthy();
  });

  it("labels Channel/Endpoint enabled state in words, not only a color dot", () => {
    render(<EnabledStatusBadge enabled={true} />);
    expect(screen.getByText("Enabled")).toBeTruthy();

    cleanup();
    render(<EnabledStatusBadge enabled={false} />);
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("labels an auto-disabled Endpoint distinctly from a manually disabled one", () => {
    render(<EnabledStatusBadge enabled={false} autoDisabledAt="2026-08-10T12:00:00.000Z" />);
    expect(screen.getByText("Auto-disabled")).toBeTruthy();
  });

  it("labels every Delivery status in the domain's own words", () => {
    for (const [status, label] of DELIVERY_STATUS_LABELS) {
      cleanup();
      render(<DeliveryStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("gives `pending` and `in_progress` different form classes, not just color", () => {
    render(<DeliveryStatusBadge status="pending" />);
    const pending = screen.getByText("pending");
    expect(pending.className).toContain("status-badge-outlined");
    expect(pending.className).not.toContain("status-badge-filled");
    cleanup();

    render(<DeliveryStatusBadge status="in_progress" />);
    const inProgress = screen.getByText("in progress");
    expect(inProgress.className).toContain("status-badge-filled");
    expect(inProgress.className).not.toContain("status-badge-outlined");
  });

  it("draws every Delivery status from DESIGN.md's status tones and no others", () => {
    // DESIGN.md §2 keeps Signal Live and Signal Cut as "the only saturated
    // colors permitted outside the accent" and declares a secondary accent
    // "deliberately absent", so these three tones are the whole vocabulary —
    // and none of them is the interface accent, which under the One Voice Rule
    // may only ever mean "the operator did this or chose this". A status that
    // reached for a fourth tone (as the indigo `pending` pill effectively did)
    // fails here.
    for (const [status, label] of DELIVERY_STATUS_LABELS) {
      cleanup();
      render(<DeliveryStatusBadge status={status} />);
      const tones = [...screen.getByText(label).classList].filter(
        (name) =>
          name.startsWith("status-badge-") &&
          !name.endsWith("filled") &&
          !name.endsWith("outlined"),
      );
      expect(tones).toHaveLength(1);
      expect(["status-badge-success", "status-badge-neutral", "status-badge-danger"]).toContain(
        tones[0],
      );
    }
  });

  describe("ChannelHealthBadge — issues #44 and #45 directory health signal", () => {
    it("reads as 'no activity' rather than healthy for a Channel with no Broadcasts", () => {
      render(
        <ChannelHealthBadge
          enabled={true}
          hasBroadcasts={false}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={0}
        />,
      );
      const badge = screen.getByText("No activity");
      expect(badge.className).toContain("status-badge-neutral");
      expect(badge.className).toContain("status-badge-outlined");
    });

    it("labels zero recent failures as healthy, distinct in text and tone from a failing Channel", () => {
      render(
        <ChannelHealthBadge
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={0}
        />,
      );
      const healthy = screen.getByText("No failures (24h)");
      expect(healthy.className).toContain("status-badge-success");
      expect(healthy.className).toContain("status-badge-filled");
      cleanup();

      render(
        <ChannelHealthBadge
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={3}
          autoDisabledEndpointCount={0}
        />,
      );
      const failing = screen.getByText("3 failing (24h)");
      expect(failing.className).toContain("status-badge-danger");
      expect(failing.className).toContain("status-badge-filled");
    });

    it("carries the failure count in its text, not only in color", () => {
      render(
        <ChannelHealthBadge
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
        <ChannelHealthBadge
          enabled={true}
          hasBroadcasts={true}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={2}
        />,
      );
      const badge = screen.getByText("2 auto-disabled");
      expect(badge.className).toContain("status-badge-danger");
      expect(badge.className).toContain("status-badge-filled");
    });

    it("combines both facts when a Channel has recent failures and an auto-disabled Endpoint", () => {
      render(
        <ChannelHealthBadge
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
        <ChannelHealthBadge
          enabled={false}
          hasBroadcasts={true}
          recentFailedDeliveryCount={2}
          autoDisabledEndpointCount={1}
        />,
      );
      const badge = screen.getByText("2 failing (24h) · 1 auto-disabled");
      expect(badge.className).toContain("status-badge-neutral");
      expect(badge.className).toContain("status-badge-outlined");
      expect(badge.className).not.toContain("status-badge-danger");
    });

    it("still names an auto-disabled Endpoint once the Channel's Broadcasts have aged out of retention", () => {
      // Only an operator clears `autoDisabledAt` (ADR 0003), but the retention
      // sweeper deletes Broadcasts after HISTORY_RETENTION_DAYS (ADR 0002), so
      // `hasBroadcasts` can fall back to false while an Endpoint is still
      // auto-disabled. `listChannels` ranks that Channel first; the badge must
      // not then read "No activity" and hide the very fact issue #45 surfaces.
      render(
        <ChannelHealthBadge
          enabled={true}
          hasBroadcasts={false}
          recentFailedDeliveryCount={0}
          autoDisabledEndpointCount={1}
        />,
      );
      const badge = screen.getByText("1 auto-disabled");
      expect(badge.className).toContain("status-badge-danger");
      expect(screen.queryByText("No activity")).toBeNull();
    });
  });
});
