import type { ComponentType } from "react";
import { Ban, Check, Clock, LoaderCircle, Minus, Power, X } from "lucide-react";
import type { DeliveryStatus, FanoutSummary } from "@webhook-broadcast/contract";

/**
 * Single status vocabulary: every place the dashboard shows state — Channel
 * enabled, Endpoint enabled/auto-disabled, Delivery status, Broadcast fan-out —
 * renders through this one lamp instead of several unrelated presentations.
 *
 * PRODUCT.md: "status is never encoded in color alone." A lamp carries the same
 * fact four independent ways, and color is only the fourth:
 *
 *  1. the glyph's shape (a check is not a slash is not a clock),
 *  2. the glass's form (lit, or a hollow unlit bezel),
 *  3. the text legend, always present and always announced,
 *  4. the tone's color.
 *
 * Remove color entirely and the state is still unambiguous, which is what
 * separates the two most confusable Delivery states (`pending` waits behind a
 * hollow clock, `in_progress` turns inside a lit one).
 *
 * The tones are DESIGN.md's status vocabulary and no more: Lamp Live, Lamp Cut,
 * and the neutral pair. A status may not invent a third hue, and it may never
 * borrow the interface's own accent, which means "the operator did this".
 */
export type LampTone = "live" | "cut" | "neutral";
export type LampForm = "lit" | "hollow";
export type LampGlyph = "ok" | "failed" | "stopped" | "working" | "waiting" | "off" | "none";

const GLYPHS: Record<LampGlyph, ComponentType<{ size: number; strokeWidth: number }>> = {
  ok: Check,
  failed: X,
  stopped: Ban,
  working: LoaderCircle,
  waiting: Clock,
  off: Power,
  none: Minus,
};

export function StatusLamp({
  label,
  tone,
  form,
  glyph,
}: {
  label: string;
  tone: LampTone;
  form: LampForm;
  glyph: LampGlyph;
}) {
  const Glyph = GLYPHS[glyph];
  return (
    <span className={`lamp lamp-${tone} lamp-${form}`}>
      <span className="lamp-glass" aria-hidden="true">
        <span className={glyph === "working" ? "lamp-spin" : undefined}>
          {/* Small glyphs need a heavier stroke than lucide's 2 default to hold
              their shape at 11px, which is the size that fits the glass without
              crowding its bezel. */}
          <Glyph size={11} strokeWidth={2.25} />
        </span>
      </span>
      {label}
    </span>
  );
}

/**
 * Channel/Endpoint `enabled` flag, folding in Endpoint's auto-disable fact
 * (ADR 0003) as its own labeled state rather than a plain grey sentence.
 * `autoDisabledAt` is ignored for Channel, which has no auto-disable concept.
 *
 * Auto-disabled is Lamp Cut, which DESIGN.md assigns to it alongside a failed
 * or dead-lettered Delivery, and it stays hollow so it is still distinguishable
 * from a lit `FAILED` lamp. Disabled is a choice rather than a fault, so it
 * takes the neutral power glyph, not the slash.
 */
export function EnabledStatusBadge({
  enabled,
  autoDisabledAt = null,
}: {
  enabled: boolean;
  autoDisabledAt?: string | null | undefined;
}) {
  if (enabled) {
    return <StatusLamp label="Enabled" tone="live" form="lit" glyph="ok" />;
  }
  if (autoDisabledAt != null) {
    return <StatusLamp label="Auto-disabled" tone="cut" form="hollow" glyph="stopped" />;
  }
  return <StatusLamp label="Disabled" tone="neutral" form="hollow" glyph="off" />;
}

function deliveryStatusLabel(status: DeliveryStatus): string {
  return status.replaceAll("_", " ");
}

const DELIVERY_STATUS_PRESENTATION: Record<
  DeliveryStatus,
  { tone: LampTone; form: LampForm; glyph: LampGlyph }
> = {
  // `pending` and `in_progress` are the pair an operator most easily confuses,
  // so they differ in form (hollow vs lit) and in glyph (a waiting clock vs a
  // turning ring) as well as in label. Both sit in the neutral family; neither
  // borrows the accent.
  pending: { tone: "neutral", form: "hollow", glyph: "waiting" },
  in_progress: { tone: "neutral", form: "lit", glyph: "working" },
  succeeded: { tone: "live", form: "lit", glyph: "ok" },
  // A `failed` Delivery still has retries left; a `dead_lettered` one has spent
  // its budget (ADR 0003). The glyph separates them: a cross is a failure, a
  // slash is a stop.
  failed: { tone: "cut", form: "lit", glyph: "failed" },
  dead_lettered: { tone: "cut", form: "lit", glyph: "stopped" },
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const { tone, form, glyph } = DELIVERY_STATUS_PRESENTATION[status];
  return <StatusLamp label={deliveryStatusLabel(status)} tone={tone} form={form} glyph={glyph} />;
}

/**
 * The Broadcast row's status lamp: every other row family carries one in its
 * fixed leading column, and this row's fan-out result would otherwise read as
 * trailing muted metadata, so a dead-lettered Broadcast would look like a
 * healthy one until the text was actually read.
 *
 * Three tones only. `total === 0` (the Channel had no enabled Endpoints when
 * this Broadcast landed) is neutral: nothing to report yet, not a failure. A
 * dead-lettered Delivery anywhere in the fan-out is Lamp Cut, checked first
 * because it is the one terminal, operator-actionable failure (a merely
 * `failed` Delivery still has retries left and does not by itself light this
 * lamp red). Everything else is Lamp Live. The count lives in the label in
 * every branch: never color alone.
 */
export function BroadcastFanoutBadge({ fanout }: { fanout: FanoutSummary }) {
  if (fanout.total === 0) {
    return <StatusLamp label="No Endpoints" tone="neutral" form="hollow" glyph="none" />;
  }
  if (fanout.deadLettered > 0) {
    return (
      <StatusLamp
        label={`${fanout.deadLettered} dead-lettered`}
        tone="cut"
        form="lit"
        glyph="stopped"
      />
    );
  }
  return (
    <StatusLamp
      label={`${fanout.succeeded}/${fanout.total} succeeded`}
      tone="live"
      form="lit"
      glyph="ok"
    />
  );
}

/**
 * Channel directory health signal (ADR 0004): the directory answers "which
 * Channels exist and are they healthy?" without opening each one, through the
 * same vocabulary as every other status here.
 *
 * Renderings, in order:
 *  - either count non-zero: the label carries both counts so a screen reader
 *    (or a colorblind operator) gets the numbers, not a dot. An auto-disabled
 *    Endpoint (ADR 0003) is otherwise silent — the Channel keeps accepting
 *    Broadcasts while fan-out to that target quietly stops — so it is named
 *    here rather than only on the Endpoints tab. Tone then depends on
 *    `enabled`: a Channel still switched on is genuinely broken (Lamp Cut,
 *    lit); one the operator has already turned off is parked, not urgent
 *    (neutral, hollow). Disabled is a choice, broken is not, and this lamp must
 *    never blend the two even though the underlying counts can be identical.
 *    `EnabledStatusBadge` already names "Disabled" beside this lamp, so this
 *    one still leads with the counts rather than repeating that word. This
 *    mirrors the directory's ordering (`packages/db`'s `listChannels`), which
 *    parks a disabled Channel in its own tier below any enabled-but-broken one.
 *  - `hasBroadcasts` false: this Channel has taken no Broadcast inside ADR
 *    0002's retention window. That is "no activity", not "healthy".
 *  - otherwise: Lamp Live, and its text says so, not just its color.
 *
 * The counts are checked *before* `hasBroadcasts` deliberately. Only an
 * operator clears `autoDisabledAt` (ADR 0003), but the retention sweeper
 * deletes Broadcasts (and cascades their Deliveries) after
 * `HISTORY_RETENTION_DAYS`, so a Channel can hold an auto-disabled Endpoint
 * while `hasBroadcasts` has fallen back to false. `listChannels` ranks that
 * Channel as needing attention and puts it at the top of the directory;
 * short-circuiting on `hasBroadcasts` first would label that very row "No
 * activity" and hide the one fact this lamp exists to surface.
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
      <StatusLamp label={label} tone="cut" form="lit" glyph="failed" />
    ) : (
      <StatusLamp label={label} tone="neutral" form="hollow" glyph="off" />
    );
  }
  if (!hasBroadcasts) {
    return <StatusLamp label="No activity" tone="neutral" form="hollow" glyph="none" />;
  }
  return <StatusLamp label="No failures (24h)" tone="live" form="lit" glyph="ok" />;
}
