import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Info, Radio, Timer, TriangleAlert } from "lucide-react";
import { loginRequestSchema } from "@webhook-broadcast/contract";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useDelayedPending } from "../lib/delayedPending.js";
import { useFieldError } from "../lib/useFieldError.js";

/** Both halves of what an icon-only control owes a screen reader: the state the
 *  key is in now, and what pressing does about it. Same shape as `ThemeToggle`. */
const REVEAL_LABEL = {
  hidden: "API key hidden. Show it.",
  shown: "API key shown. Hide it.",
} as const;

function secondsUntil(resetAtMs: number): number {
  return Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000));
}

/**
 * Seconds remaining until `resetAtMs`, so the rate-limited cooldown counts
 * down live (issue #91) rather than showing a single frozen estimate. `null`
 * when there is nothing to count down to.
 *
 * The returned value is derived during render rather than read back out of
 * state: an effect first runs after the browser has painted, so seeding the
 * count from the effect alone would render one frame of an enabled "Sign in"
 * button immediately after the 429 that disabled it. The state exists only to
 * schedule re-renders, and it holds whole seconds so React's bail-out on an
 * unchanged value keeps the 250ms poll from re-rendering four times a second
 * for a reading that changes once (PRODUCT.md #6: an instrument does not
 * twitch). The poll is finer than the reading so the displayed second turns
 * over close to when it actually elapses.
 */
function useCountdownSeconds(resetAtMs: number | null): number | null {
  const [, setTickedSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (resetAtMs === null) {
      return;
    }

    const tick = (): void => {
      setTickedSeconds(secondsUntil(resetAtMs));
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [resetAtMs]);

  return resetAtMs === null ? null : secondsUntil(resetAtMs);
}

/**
 * The rule this field enforces is the contract's, stated once and read here —
 * the same shape as `EndpointForm`'s `validateUrl` and `ChannelSettingsForm`'s
 * `validateSlug`. PRODUCT.md Principle 7: a constraint the browser can check
 * is checked in the browser, at the field, using the schema the contract
 * package already holds (`loginRequestSchema`'s `apiKey: z.string().min(1)`),
 * not hand-restated as a `.length === 0` check on the button.
 *
 * Because that schema's only rule is non-emptiness, a non-empty value always
 * passes it — there is no second server-only constraint to surface, and no
 * case where this field validates locally yet the admin API still answers
 * `400 validation_failed` for the same reason. That is what makes the empty
 * `validation_failed` path unreachable by construction once this runs before
 * every submit (see `handleSubmit`), rather than merely rare.
 */
function validateApiKey(value: string): string | null {
  if (value.length === 0) {
    return "API key is required.";
  }
  const result = loginRequestSchema.safeParse({ apiKey: value });
  if (result.success) {
    return null;
  }
  return result.error.issues[0]?.message ?? "API key is required.";
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface Cooldown {
  /** Epoch ms the 429 reported its cooldown ends. */
  readonly resetAt: number;
  /**
   * Seconds left when the 429 arrived. Announced once and never recomputed:
   * the visible countdown ticks, and an assertive live region re-reads its
   * whole content on every mutation, so announcing the ticking figure would
   * make a screen reader recite the notice once a second for the entire
   * cooldown. DESIGN.md names that failure mode under the advisory rule.
   */
  readonly announcedSeconds: number;
}

export function LoginPage({
  onLoggedIn,
  theme,
  onCycleTheme,
}: {
  onLoggedIn: () => void;
  theme: "system" | "light" | "dark";
  onCycleTheme: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingLabel = useDelayedPending(submitting);
  const Glyph = revealed ? EyeOff : Eye;
  const apiKeyField = useFieldError<string, HTMLInputElement>(apiKey, validateApiKey);

  // Set only from a 429 (issue #91): the cooldown is a distinct state from an
  // invalid key, not a reworded version of the same error, so it gets its own
  // piece of state rather than living inside `error`.
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);
  const cooldownSeconds = useCountdownSeconds(cooldown?.resetAt ?? null);
  const activeCooldown =
    cooldown !== null && cooldownSeconds !== null && cooldownSeconds > 0
      ? { ...cooldown, remainingSeconds: cooldownSeconds }
      : null;

  // The window has actually elapsed: clear it so the form re-enables on its
  // own, without waiting for another submit attempt.
  useEffect(() => {
    if (cooldown !== null && cooldownSeconds === 0) {
      setCooldown(null);
    }
  }, [cooldown, cooldownSeconds]);

  useEffect(() => {
    document.title = "Sign in · webhook-broadcast";
  }, []);

  // One slot, two judges, in that order of precedence — the same precedence
  // EndpointForm and ChannelSettingsForm give a field's own message over the
  // form-level error. They can both have something to say at once: a rejected
  // key leaves `error` standing (it is replaced by an outcome, never cleared
  // ahead of one — #94), so clearing the field to retype puts the local rule
  // over the top of it. The local one wins there because it describes the
  // value the operator is holding now, where `error` describes the one they
  // already sent.
  const fieldMessage = apiKeyField.error ?? error;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    // `disabled` no longer flips the instant `submitting` does — it waits on
    // `useDelayedPending`, so for the first 250ms the control is still live and
    // a second click would fire a second `api.login` against a rate-limited
    // endpoint. The guard belongs here rather than on `disabled`: the No-Flicker
    // Rule wants the control to look calm, not to accept the work twice (#94).
    if (submitting) return;

    // A submit attempt marks the field and blocks on it, rather than sending
    // input the admin API is certain to reject (DESIGN.md §5's
    // Reward-Early-Punish-Late Rule; same shape as EndpointForm/
    // ChannelSettingsForm's submit-time `markTouched`/`isInvalid` gate).
    apiKeyField.markTouched();
    if (apiKeyField.isInvalid()) {
      apiKeyField.ref.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await api.login(apiKey);
      // `error` is replaced by whichever outcome actually arrives, never
      // cleared ahead of it — clearing here would unmount `.error-text` for
      // one frame on every attempt, and `.centered`'s `align-items: center`
      // turns that into the card bouncing on the very axis PRODUCT.md #6
      // says must stay still (#94).
      setError(null);
      onLoggedIn();
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === "rate_limited" &&
        err.resetAt !== undefined
      ) {
        // A cooldown blames nobody's key, so it takes neither the error line
        // nor the invalid-field marking below: the window is already running
        // and there is nothing for the operator to correct in the field (#91).
        setCooldown({
          resetAt: err.resetAt,
          announcedSeconds: Math.max(1, secondsUntil(err.resetAt)),
        });
      } else {
        setError(describeApiError(err, "Failed to sign in"));
        // DESIGN.md §5's Reward-Early-Punish-Late Rule: a rejected submit marks
        // the blamed field and moves focus to it, so the operator never has to
        // guess where the form stopped. Local validation already screens out
        // an empty key before this request is sent (see `validateApiKey`), so
        // what lands here is always a server-only judgment — a wrong key
        // (`unauthorized`) or, defensively, a `validation_failed` this form
        // cannot otherwise produce — and either way the one field this form
        // has is where it belongs.
        apiKeyField.ref.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="centered">
      <form
        className="plate login-card field-stack"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="login-header">
          <h1>
            <Radio className="app-brand-mark" size={20} strokeWidth={2} aria-hidden="true" />
            webhook-broadcast
          </h1>
          {/* The theme is a preference of this browser, available before there is
              a session to attach it to. */}
          <ThemeToggle theme={theme} onCycle={onCycleTheme} />
        </div>
        <div className="field">
          <label htmlFor="apiKey">Operator API key</label>
          {/* This is a shared bootstrap secret, not a per-person password: `type="password"`
              with no username field is exactly the pattern Chrome's own DevTools flags
              ("Password forms should have (optionally hidden) username fields for
              accessibility"), and it invites a password manager to file the one shared
              key under an empty identity as if it were someone's personal login. Staying
              off `type="password"` (and its `autocomplete` family) keeps this from being
              filed as a login credential at all; masking is recreated with
              `-webkit-text-security` (see `.masked-field` in styles.css) and lifted by the
              reveal toggle so a pasted key can be checked before it spends one of the five
              rate-limited attempts. */}
          <div className="field-with-action">
            <input
              ref={apiKeyField.ref}
              id="apiKey"
              className="field-control masked-field"
              type="text"
              name="apiKey"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onBlur={apiKeyField.onBlur}
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              data-revealed={revealed}
              aria-invalid={fieldMessage ? "true" : "false"}
              // The standing advisory always describes the field; a rejection adds the
              // error region to it rather than replacing it, so the operator keeps the
              // bootstrap-versus-minted guidance exactly when a rejected key makes it
              // most worth hearing.
              aria-describedby={fieldMessage ? "api-key-source apiKey-error" : "api-key-source"}
            />
            <button
              type="button"
              className="control control-icon field-reveal-toggle"
              aria-pressed={revealed}
              aria-label={revealed ? REVEAL_LABEL.shown : REVEAL_LABEL.hidden}
              title={revealed ? REVEAL_LABEL.shown : REVEAL_LABEL.hidden}
              onClick={() => setRevealed((value) => !value)}
            >
              <Glyph
                className="control-icon-glyph"
                size={13}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          </div>
          {/* Standing guidance, not a validation result, so the input points at it
              with `aria-describedby` the way the new-Channel slug rule does: the
              bootstrap-versus-minted distinction is the whole reason the advisory
              exists, and a keyboard operator lands on the autofocused field without
              ever passing the paragraph beneath it. */}
          <p className="advisory" id="api-key-source">
            <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              This is the bootstrap credential <code>OPERATOR_API_KEY</code> from your deployment,
              not an operator token created in Settings.
            </span>
          </p>
          {/* Mounted for the life of the form, not only from the moment `error`
              is first set: a `role="alert"` region that is conditionally
              mounted depends on the AT noticing its insertion, where a text
              change inside a region that already exists is announced
              reliably on every failed submit, not only the first one (Issue
              #92). Empty, it still holds one line's height here rather than
              collapsing the way `.error-text:empty` does on every other form:
              this card sits inside `.centered`, so a line that appears and
              disappears re-centers the whole plate on the very axis
              PRODUCT.md #6 says must stay still — see
              `.login-card .error-text:empty` in styles.css (#94). */}
          <p className="error-text" id="apiKey-error" role="alert">
            {fieldMessage && (
              <>
                <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
                {fieldMessage}
              </>
            )}
          </p>
        </div>
        {/* Deliberately not `.error-text`: PRODUCT.md's emotional goal for this
            moment is "I am in a cooldown", not "the login is broken", and
            reusing the invalid-key error's exact ink, glyph, and position would
            say the latter no matter what the copy read. It sits outside the
            field for the same reason — the key is not what is wrong, so the
            notice does not hang off it (#91). The wrapper is the existing
            `.advisory-region`, already the shape for a line standing beside an
            advisory well. */}
        {activeCooldown !== null && (
          <div className="advisory-region">
            {/* Announced once, on mount, with the figure frozen — see `Cooldown`.
                Its own region rather than the field's standing `.error-text`
                alert (#92): that one is bound to `error`, which a cooldown never
                sets, and routing the countdown through it would put a wait in
                the place reserved for a rejected key. */}
            <p className="visually-hidden" role="alert">
              Too many attempts. Try again in {activeCooldown.announcedSeconds} seconds.
            </p>
            <p className="rate-limit-notice" aria-hidden="true">
              <Timer
                className="rate-limit-notice-icon"
                size={14}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>
                Too many attempts. Try again in{" "}
                <span className="rate-limit-countdown">
                  {formatCountdown(activeCooldown.remainingSeconds)}
                </span>
                .
              </span>
            </p>
            <p className="advisory">
              <Info className="advisory-icon" size={14} strokeWidth={2} aria-hidden="true" />
              This cooldown is shared by everyone signing in from this network, not just this
              attempt.
            </p>
          </div>
        )}
        <button
          type="submit"
          className="control control-primary login-submit"
          // DESIGN.md §5's Reward-Early-Punish-Late Rule: the submit control is
          // never disabled to express invalidity, only while a request is
          // genuinely in flight (or a 429 cooldown is running) — an empty key
          // is rejected at the field (`apiKeyField`/`fieldMessage` above), not
          // by a button an operator can't press to find out why.
          disabled={submittingLabel || activeCooldown !== null}
        >
          {/*
            Both labels are always in the DOM, stacked in the same grid cell,
            so the button's width is the wider label's width regardless of
            which is visible — it does not resize when the pending label
            appears (#94). `disabled` and the label share the same
            `useDelayedPending` output, so the control only dims once it is
            genuinely slow, exactly when it starts saying so.
          */}
          <span
            className="login-submit-label"
            aria-hidden={submittingLabel || activeCooldown !== null}
            data-visible={!submittingLabel && activeCooldown === null}
          >
            Sign in
          </span>
          <span
            className="login-submit-label"
            aria-hidden={!submittingLabel || activeCooldown !== null}
            data-visible={submittingLabel && activeCooldown === null}
          >
            Signing in…
          </span>
          {/* Mounted only for the cooldown, unlike its two siblings. They are
              permanent because they trade places inside one round trip and the
              button may not resize mid-flight; this one arrives once, on a 429,
              and only ever widens the stack while the control is disabled — so
              carrying its width at rest would cost the resting button the space
              of a countdown it is not showing (#94). */}
          {activeCooldown !== null && (
            <span className="login-submit-label" data-visible={true}>
              Try again in {formatCountdown(activeCooldown.remainingSeconds)}
            </span>
          )}
        </button>
      </form>
    </main>
  );
}
