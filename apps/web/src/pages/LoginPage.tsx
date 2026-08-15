import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Info, Radio, TriangleAlert } from "lucide-react";
import { api, describeApiError } from "../lib/api.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useDelayedPending } from "../lib/delayedPending.js";

/** Both halves of what an icon-only control owes a screen reader: the state the
 *  key is in now, and what pressing does about it. Same shape as `ThemeToggle`. */
const REVEAL_LABEL = {
  hidden: "API key hidden. Show it.",
  shown: "API key shown. Hide it.",
} as const;

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
  const apiKeyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Sign in · webhook-broadcast";
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    // `disabled` no longer flips the instant `submitting` does — it waits on
    // `useDelayedPending`, so for the first 250ms the control is still live and
    // a second click would fire a second `api.login` against a rate-limited
    // endpoint. The guard belongs here rather than on `disabled`: the No-Flicker
    // Rule wants the control to look calm, not to accept the work twice (#94).
    if (submitting) return;
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
      setError(describeApiError(err, "Failed to sign in"));
      // DESIGN.md §5's Reward-Early-Punish-Late Rule: a rejected submit marks
      // the blamed field and moves focus to it, so the operator never has to
      // guess where the form stopped. The sibling forms reach that state by
      // local validation; login's only judge is the admin API, and the API key
      // is the one field this form has, so a rejection always blames it.
      apiKeyRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="centered">
      <form className="plate login-card field-stack" onSubmit={(event) => void handleSubmit(event)}>
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
              ref={apiKeyRef}
              id="apiKey"
              className="field-control masked-field"
              type="text"
              name="apiKey"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              data-revealed={revealed}
              aria-invalid={error ? "true" : "false"}
              // The standing advisory always describes the field; a rejection adds the
              // error region to it rather than replacing it, so the operator keeps the
              // bootstrap-versus-minted guidance exactly when a rejected key makes it
              // most worth hearing.
              aria-describedby={error ? "api-key-source apiKey-error" : "api-key-source"}
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
            {error && (
              <>
                <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
                {error}
              </>
            )}
          </p>
        </div>
        <button
          type="submit"
          className="control control-primary login-submit"
          disabled={submittingLabel || apiKey.length === 0}
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
            aria-hidden={submittingLabel}
            data-visible={!submittingLabel}
          >
            Sign in
          </span>
          <span
            className="login-submit-label"
            aria-hidden={!submittingLabel}
            data-visible={submittingLabel}
          >
            Signing in…
          </span>
        </button>
      </form>
    </main>
  );
}
