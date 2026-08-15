// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoginPage } from "../src/pages/LoginPage.js";

afterEach(() => {
  cleanup();
});

function renderLoginPage() {
  return render(<LoginPage onLoggedIn={() => {}} theme="system" onCycleTheme={() => {}} />);
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
