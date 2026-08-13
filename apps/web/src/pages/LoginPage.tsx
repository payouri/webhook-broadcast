import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api.js";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
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
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="centered">
      <form className="card login-card" onSubmit={(event) => void handleSubmit(event)}>
        <h1>webhook-broadcast</h1>
        <p className="muted">Find your key in the OPERATOR_API_KEY environment variable.</p>
        <label htmlFor="apiKey">Operator API key</label>
        <input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoFocus
          required
        />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || apiKey.length === 0}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
