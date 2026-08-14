import { useEffect, useState, type FormEvent } from "react";
import { Radio } from "lucide-react";
import { api, describeApiError } from "../lib/api.js";
import { ThemeToggle } from "../components/ThemeToggle.js";

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

  useEffect(() => {
    document.title = "Log in · webhook-broadcast";
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(apiKey);
      onLoggedIn();
    } catch (err) {
      setError(describeApiError(err, "Login failed"));
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
        <p className="prose">Find your key in the OPERATOR_API_KEY environment variable.</p>
        <div className="field">
          <label htmlFor="apiKey">Operator API key</label>
          <input
            id="apiKey"
            type="password"
            name="apiKey"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoFocus
            required
            autoComplete="current-password"
          />
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
