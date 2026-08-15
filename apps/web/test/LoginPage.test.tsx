// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../src/pages/LoginPage.js";
import { requestPath, stubFetchMock } from "./fetchMock.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderLoginPage() {
  return render(<LoginPage onLoggedIn={() => {}} theme="system" onCycleTheme={() => {}} />);
}

function apiKeyField(): HTMLInputElement {
  return screen.getByLabelText("Operator API key") as HTMLInputElement;
}

function errorRegion(): HTMLElement {
  const region = document.getElementById("apiKey-error");
  if (!region) {
    throw new Error("the login form has no #apiKey-error region");
  }
  return region;
}

/**
 * Submits a key the mock rejects and waits for *this* attempt's message. Each
 * attempt is given its own message so the wait cannot be satisfied by the
 * previous attempt's text still standing in the region.
 */
async function submitRejectedKey(key: string, expected: string): Promise<void> {
  fireEvent.change(apiKeyField(), { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => {
    expect(errorRegion().textContent).toContain(expected);
  });
}

describe("LoginPage operator key field", () => {
  it("is not a native password field, so it is never filed as a login credential", async () => {
    const { container } = renderLoginPage();

    const input = await screen.findByLabelText("Operator API key");
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("autocomplete")).toBe("off");
    // The whole form, not just this field: Chrome's warning is structural, and it
    // fires on any password input that has no username field beside it.
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it("keeps the key out of spellcheck and mobile text correction", async () => {
    renderLoginPage();

    const input = await screen.findByLabelText("Operator API key");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
  });

  it("masks the value by default and reveals it when the toggle is activated", async () => {
    renderLoginPage();

    const input = await screen.findByLabelText("Operator API key");
    // Masking is `.masked-field[data-revealed="false"]` in styles.css; jsdom loads
    // no stylesheet, so the hook the rule hangs off is what is asserted here.
    expect(input.classList.contains("masked-field")).toBe(true);
    expect(input.getAttribute("data-revealed")).toBe("false");

    const toggle = screen.getByRole("button", { name: "API key hidden. Show it." });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    expect(input.getAttribute("data-revealed")).toBe("true");
    const pressed = screen.getByRole("button", { name: "API key shown. Hide it." });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(pressed);
    expect(input.getAttribute("data-revealed")).toBe("false");
  });

  it("offers the reveal as a real button in the natural tab order", async () => {
    renderLoginPage();

    const toggle = screen.getByRole("button", { name: "API key hidden. Show it." });
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(toggle.tabIndex).toBe(0);
  });
});

/**
 * Issue #92: the login field is the one field on this screen, and until now a
 * rejected submit left it reporting itself perfectly valid — so
 * `.field-control[aria-invalid="true"]`'s Lamp Cut border (styles.css) could
 * never render here, and the alert had no stated relationship to the field it
 * blamed. These pin the field-error contract DESIGN.md §5 Fields — Error
 * states, on the only form that was missing it.
 */
describe("LoginPage field error", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    stubFetchMock(fetchMock);
  });

  it("leaves the field unmarked, with the alert region already standing, before any submit", () => {
    renderLoginPage();

    expect(apiKeyField().getAttribute("aria-invalid")).toBe("false");
    // Only the standing advisory describes an untouched field; the empty error
    // region is not yet worth pointing the screen reader at.
    expect(apiKeyField().getAttribute("aria-describedby")).toBe("api-key-source");
    // Present from first paint, empty. It is the standing region #92 needs;
    // #94 is what keeps it occupying its line while empty rather than
    // collapsing the way `.error-text:empty` does on every other form.
    expect(errorRegion().getAttribute("role")).toBe("alert");
    expect(errorRegion().textContent).toBe("");
  });

  it("marks the field invalid, describes it by the error, and takes focus on a rejected submit", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "that key was rejected" } }),
    );

    renderLoginPage();
    fireEvent.change(apiKeyField(), { target: { value: "wrong-key" } });
    // Focus starts on the field (`autoFocus`), so parking it on the submit
    // control first is what makes the assertion below about the catch block's
    // `focus()` rather than about the initial mount.
    const submit = screen.getByRole("button", { name: "Sign in" });
    submit.focus();
    expect(document.activeElement).toBe(submit);

    fireEvent.click(submit);
    await waitFor(() => {
      expect(errorRegion().textContent).toContain("that key was rejected");
    });

    expect(apiKeyField().getAttribute("aria-invalid")).toBe("true");
    // The error joins the advisory rather than displacing it.
    expect(apiKeyField().getAttribute("aria-describedby")).toBe("api-key-source apiKey-error");
    expect(errorRegion().textContent).toContain("that key was rejected");
    // The warning glyph every other form's error carries, hidden from AT.
    expect(errorRegion().querySelector("svg[aria-hidden='true']")).toBeTruthy();
    expect(document.activeElement).toBe(apiKeyField());
  });

  it("announces a second rejection through the same standing region, not a fresh mount", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "unauthorized", message: "that key was rejected" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: { code: "unauthorized", message: "that key was rejected again" },
        }),
      );

    renderLoginPage();
    const before = errorRegion();

    await submitRejectedKey("wrong-key", "that key was rejected");
    expect(errorRegion()).toBe(before);

    // The second rejection is a text change inside a region the AT already
    // knows, rather than an insertion it has to notice a second time.
    await submitRejectedKey("wrong-again", "that key was rejected again");
    expect(errorRegion()).toBe(before);
  });

  it("unmarks the field once a submit is accepted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "unauthorized", message: "that key was rejected" } }),
    );

    renderLoginPage();
    await submitRejectedKey("wrong-key", "that key was rejected");

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    fireEvent.change(apiKeyField(), { target: { value: "right-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(apiKeyField().getAttribute("aria-invalid")).toBe("false");
    });
    expect(apiKeyField().getAttribute("aria-describedby")).toBe("api-key-source");
    expect(errorRegion().textContent).toBe("");
  });
});

/**
 * Issue #93: the submit control used to gate on `apiKey.length === 0` — a
 * hand-restated copy of `loginRequestSchema`'s own `apiKey: z.string().min(1)`
 * — leaving the button permanently disabled (and low-contrast) at first
 * paint. These pin that the empty case is now caught at the field, against
 * the contract schema, with the button left alive throughout.
 */
describe("LoginPage empty-key validation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    stubFetchMock(fetchMock);
  });

  it("leaves the submit control enabled at first paint, with an empty key", () => {
    renderLoginPage();

    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("rejects an empty submit at the field, with a message, and never calls the API", async () => {
    renderLoginPage();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(errorRegion().textContent).toContain("API key is required.");
    });
    expect(apiKeyField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(apiKeyField());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the field message as soon as a key is typed", async () => {
    renderLoginPage();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(errorRegion().textContent).toContain("API key is required.");
    });

    fireEvent.change(apiKeyField(), { target: { value: "a-real-key" } });
    expect(errorRegion().textContent).toBe("");
    expect(apiKeyField().getAttribute("aria-invalid")).toBe("false");
  });

  /**
   * The two judges share one slot, so the order they speak in is behaviour,
   * not an implementation detail: a rejected key leaves the server's message
   * standing (#94 — it is replaced by an outcome, never cleared ahead of one),
   * and clearing the field to retype has to put the local rule over the top of
   * it rather than leaving the operator reading a verdict on a value that is
   * no longer in the field.
   */
  it("lets the local rule speak over a standing server rejection, and hands the slot back", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "unauthorized", message: "that key was rejected" } }),
    );

    renderLoginPage();
    await submitRejectedKey("wrong-key", "that key was rejected");

    fireEvent.change(apiKeyField(), { target: { value: "" } });
    expect(errorRegion().textContent).toContain("API key is required.");

    fireEvent.change(apiKeyField(), { target: { value: "another-key" } });
    expect(errorRegion().textContent).toContain("that key was rejected");
  });
});

function typeKey(value: string): void {
  fireEvent.change(apiKeyField(), { target: { value } });
}

function clickSubmit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

/**
 * Issue #94, PRODUCT.md #6: the login card may not move while it reports a
 * failure. The bounce came from the error paragraph mounting and unmounting
 * inside `.centered`, so what these assert is element *identity* and *presence*
 * across attempts — jsdom has no layout, but a paragraph that is never
 * unmounted, paired with `.login-card .error-text:empty` holding its line
 * while it has nothing to say, is a card whose height never changes.
 */
describe("LoginPage — the card stops moving when it reports a failure (issue #94)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  it("keeps the error line mounted before, during and after a failed attempt", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      expect(requestPath(input)).toBe("/auth/login");
      return Promise.resolve(
        jsonResponse(401, { error: { code: "unauthorized", message: "Invalid operator API key" } }),
      );
    });

    renderLoginPage();
    // Present with nothing to say. `.login-card .error-text:empty` (styles.css)
    // holds it at `1lh` while it is empty, so the message costs the card no
    // vertical space later; jsdom loads no stylesheet, so what is asserted here
    // is the node the rule hangs off being mounted and empty.
    const line = screen.getByRole("alert");
    expect(line.textContent?.trim()).toBe("");

    typeKey("wrong");
    clickSubmit();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Invalid operator API key"),
    );
    // The same node, not a replacement: React never unmounted the paragraph.
    expect(screen.getByRole("alert")).toBe(line);
  });

  it("replaces the message when the next outcome arrives instead of clearing it on submit", async () => {
    const pending: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );

    renderLoginPage();
    typeKey("wrong");
    clickSubmit();
    pending.shift()?.(
      jsonResponse(401, { error: { code: "unauthorized", message: "Invalid operator API key" } }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Invalid operator API key"),
    );

    // Second attempt: the previous message stays on screen for the whole
    // round trip rather than being cleared at submit time, which is what made
    // the card bounce once per attempt on the rate-limited path.
    clickSubmit();
    expect(screen.getByRole("alert").textContent).toContain("Invalid operator API key");

    pending.shift()?.(
      jsonResponse(429, { error: { code: "rate_limited", message: "Too many attempts" } }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Too many attempts"),
    );
  });

  it("does not dim the control for a fast round trip, and still admits only one login", async () => {
    const pending: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );

    renderLoginPage();
    typeKey("secret");
    const button = screen.getByRole("button", { name: "Sign in" });
    clickSubmit();

    // DESIGN.md §5: nothing about waiting is rendered inside the delay window,
    // and `disabled` is part of "rendered" — it dims the primary control.
    expect(button.hasAttribute("disabled")).toBe(false);

    // …which means the guard against a second request has to live in the
    // handler, not in `disabled`.
    clickSubmit();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.shift()?.(jsonResponse(200, { ok: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("keeps both submit labels mounted so the button cannot resize between them", () => {
    renderLoginPage();
    // Only the wider one is ever measured: both share a grid cell, so the
    // button's width is fixed regardless of which is visible.
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByText("Signing in…")).toBeTruthy();
  });
});
