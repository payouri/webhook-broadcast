import type { DeliveryStatus } from "@webhook-broadcast/contract";

/**
 * Single status vocabulary (issue #43): every place the dashboard shows state —
 * Channel enabled, Endpoint enabled/auto-disabled, and Delivery status — renders
 * through this one presentation instead of three unrelated ones (a color-only dot,
 * a text pill, and a plain sentence).
 *
 * PRODUCT.md: "status is never encoded in color alone." Every badge carries a text
 * label (so it is announced meaningfully by a screen reader with no extra markup),
 * and `tone`/`form` combine so the two most confusable Delivery states — `pending`
 * and `in_progress` — differ in outline-vs-filled form as well as color, and no
 * Delivery tone reuses the interface's indigo accent.
 *
 * The tones are exactly DESIGN.md's status vocabulary and no more: Signal Live
 * (`success`), Signal Cut (`danger`), and the neutral ink/sunk pair (`neutral`).
 * DESIGN.md §2 keeps Signal Live and Signal Cut as "the only saturated colors
 * permitted outside the accent" and declares a secondary accent "deliberately
 * absent", so a status must not invent a fourth hue.
 */
export type StatusTone = "success" | "neutral" | "danger";
export type StatusForm = "filled" | "outlined";

export function StatusBadge({
  label,
  tone,
  form,
}: {
  label: string;
  tone: StatusTone;
  form: StatusForm;
}) {
  return <span className={`status-badge status-badge-${tone} status-badge-${form}`}>{label}</span>;
}

/**
 * Channel/Endpoint `enabled` flag, folding in Endpoint's auto-disable fact
 * (ADR 0003) as its own labeled state rather than a plain grey sentence.
 * `autoDisabledAt` is ignored for Channel, which has no auto-disable concept.
 *
 * Auto-disabled carries Signal Cut, which DESIGN.md §2 assigns to "an
 * auto-disabled Endpoint" alongside a failed or dead-lettered Delivery; it stays
 * outlined so it is still distinguishable from a filled `FAILED` stamp.
 */
export function EnabledStatusBadge({
  enabled,
  autoDisabledAt = null,
}: {
  enabled: boolean;
  autoDisabledAt?: string | null | undefined;
}) {
  if (enabled) {
    return <StatusBadge label="Enabled" tone="success" form="filled" />;
  }
  if (autoDisabledAt != null) {
    return <StatusBadge label="Auto-disabled" tone="danger" form="outlined" />;
  }
  return <StatusBadge label="Disabled" tone="neutral" form="outlined" />;
}

function deliveryStatusLabel(status: DeliveryStatus): string {
  return status.replaceAll("_", " ");
}

const DELIVERY_STATUS_PRESENTATION: Record<DeliveryStatus, { tone: StatusTone; form: StatusForm }> =
  {
    // DESIGN.md §5 Chips: "`IN PROGRESS` is Ink on Surface Sunk, filled.
    // `PENDING` is Ink Muted on transparent with a 1px Hairline Strong border,
    // outlined." Both sit in the neutral family — never the interface's indigo
    // accent — and differ in fill *and* in ink, so they stay distinct whether or
    // not color survives.
    pending: { tone: "neutral", form: "outlined" },
    in_progress: { tone: "neutral", form: "filled" },
    succeeded: { tone: "success", form: "filled" },
    failed: { tone: "danger", form: "filled" },
    dead_lettered: { tone: "danger", form: "filled" },
  };

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const { tone, form } = DELIVERY_STATUS_PRESENTATION[status];
  return <StatusBadge label={deliveryStatusLabel(status)} tone={tone} form={form} />;
}

/**
 * Channel directory failure signal (issue #44): ADR 0004 wants the directory
 * to answer "which Channels exist and are they healthy?" without opening
 * each one, so this reads through the same vocabulary as every other status
 * here rather than inventing a fourth way to show state.
 *
 * Three distinct renderings, per the issue's acceptance criteria:
 *  - `hasBroadcasts` false: this Channel has never taken a Broadcast at all.
 *    That is "no activity", not "healthy" — neutral/outlined, same family as
 *    `EnabledStatusBadge`'s "Disabled".
 *  - zero recent failures: Signal Live, filled — healthy, and its text says
 *    so, not just its color.
 *  - one or more: Signal Cut, filled, and the label carries the count so a
 *    screen reader (or a colorblind operator) gets the number, not a dot.
 */
export function ChannelHealthBadge({
  hasBroadcasts,
  recentFailedDeliveryCount,
}: {
  hasBroadcasts: boolean;
  recentFailedDeliveryCount: number;
}) {
  if (!hasBroadcasts) {
    return <StatusBadge label="No activity" tone="neutral" form="outlined" />;
  }
  if (recentFailedDeliveryCount === 0) {
    return <StatusBadge label="No failures (24h)" tone="success" form="filled" />;
  }
  return (
    <StatusBadge label={`${recentFailedDeliveryCount} failing (24h)`} tone="danger" form="filled" />
  );
}
