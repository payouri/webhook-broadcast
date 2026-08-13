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

  describe("ChannelHealthBadge — issue #44 directory failure signal", () => {
    it("reads as 'no activity' rather than healthy for a Channel with no Broadcasts", () => {
      render(<ChannelHealthBadge hasBroadcasts={false} recentFailedDeliveryCount={0} />);
      const badge = screen.getByText("No activity");
      expect(badge.className).toContain("status-badge-neutral");
      expect(badge.className).toContain("status-badge-outlined");
    });

    it("labels zero recent failures as healthy, distinct in text and tone from a failing Channel", () => {
      render(<ChannelHealthBadge hasBroadcasts={true} recentFailedDeliveryCount={0} />);
      const healthy = screen.getByText("No failures (24h)");
      expect(healthy.className).toContain("status-badge-success");
      expect(healthy.className).toContain("status-badge-filled");
      cleanup();

      render(<ChannelHealthBadge hasBroadcasts={true} recentFailedDeliveryCount={3} />);
      const failing = screen.getByText("3 failing (24h)");
      expect(failing.className).toContain("status-badge-danger");
      expect(failing.className).toContain("status-badge-filled");
    });

    it("carries the failure count in its text, not only in color", () => {
      render(<ChannelHealthBadge hasBroadcasts={true} recentFailedDeliveryCount={7} />);
      expect(screen.getByText("7 failing (24h)")).toBeTruthy();
    });
  });
});
