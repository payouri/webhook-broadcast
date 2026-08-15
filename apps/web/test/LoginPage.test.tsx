// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../src/pages/LoginPage.js";
import { stubFetchMock } from "./fetchMock.js";

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
    // Present from first paint, empty: `.error-text:empty` collapses it, so an
    // untouched form reserves no space for a message it may never show.
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
