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
 * Channel directory health signal (issues #44 and #45): ADR 0004 wants the
 * directory to answer "which Channels exist and are they healthy?" without
 * opening each one, so this reads through the same vocabulary as every other
 * status here rather than inventing a fourth way to show state.
 *
 * Renderings, in order:
 *  - either count non-zero: the label carries both counts (when present) so
 *    a screen reader (or a colorblind operator) gets the numbers, not a
 *    dot. An auto-disabled Endpoint (ADR 0003) is otherwise silent — the
 *    Channel keeps accepting Broadcasts while fan-out to that target
 *    quietly stops — so it is named here rather than only on the Endpoints
 *    tab. Tone then depends on `enabled`: a Channel still switched on is
 *    genuinely broken (Signal Cut, filled); one the operator has already
 *    turned off is parked, not urgent (neutral, outlined) — disabled is a
 *    choice, broken is not, and this badge must never blend the two even
 *    though the underlying counts can be identical. `EnabledStatusBadge`
 *    already names "Disabled" beside this badge, so this one still leads
 *    with the counts rather than repeating that word. This mirrors the
 *    Channel directory's ordering (`packages/db`'s `listChannels`), which
 *    parks a disabled Channel in its own tier below any enabled-but-broken
 *    one for the same reason.
 *  - `hasBroadcasts` false: this Channel has taken no Broadcast inside
 *    ADR 0002's retention window. That is "no activity", not "healthy" —
 *    neutral/outlined, same family as `EnabledStatusBadge`'s "Disabled".
 *  - otherwise: Signal Live, filled — healthy, and its text says so, not
 *    just its color.
 *
 * The counts are checked *before* `hasBroadcasts` deliberately. Only an
 * operator clears `autoDisabledAt` (ADR 0003), but the retention sweeper
 * deletes Broadcasts (and cascades their Deliveries) after
 * `HISTORY_RETENTION_DAYS`, so a Channel can hold an auto-disabled Endpoint
 * while `hasBroadcasts` has fallen back to false. `listChannels` ranks that
 * Channel as needing attention and puts it at the top of the directory;
 * short-circuiting on `hasBroadcasts` first would label that very row "No
 * activity" and hide the one fact issue #45 exists to surface.
 */
export function ChannelHealthBadge({
  enabled,
  hasBroadcasts,
  recentFailedDeliveryCount,
  autoDisabledEndpointCount,
}: {
  enabled: boolean;
  hasBroadcasts: boolean;
  recentFailedDeliveryCount: number;
  autoDisabledEndpointCount: number;
}) {
  const parts: string[] = [];
  if (recentFailedDeliveryCount > 0) {
    parts.push(`${recentFailedDeliveryCount} failing (24h)`);
  }
  if (autoDisabledEndpointCount > 0) {
    parts.push(`${autoDisabledEndpointCount} auto-disabled`);
  }
  if (parts.length > 0) {
    const label = parts.join(" · ");
    return enabled ? (
      <StatusBadge label={label} tone="danger" form="filled" />
    ) : (
      <StatusBadge label={label} tone="neutral" form="outlined" />
    );
  }
  if (!hasBroadcasts) {
    return <StatusBadge label="No activity" tone="neutral" form="outlined" />;
  }
  return <StatusBadge label="No failures (24h)" tone="success" form="filled" />;
}
