import { useEffect, useState, type FormEvent } from "react";
import { Info, Radio } from "lucide-react";
import { api, describeApiError } from "../lib/api.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useDelayedPending } from "../lib/delayedPending.js";

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingLabel = useDelayedPending(submitting);

  useEffect(() => {
    document.title = "Sign in · webhook-broadcast";
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(apiKey);
      onLoggedIn();
    } catch (err) {
      setError(describeApiError(err, "Failed to sign in"));
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
          <input
            id="apiKey"
            className="field-control"
            type="password"
            name="apiKey"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoFocus
            required
            autoComplete="current-password"
            aria-describedby="api-key-source"
          />
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
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="control control-primary"
          disabled={submitting || apiKey.length === 0}
        >
          {submittingLabel ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
