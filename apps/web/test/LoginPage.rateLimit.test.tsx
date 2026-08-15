// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../src/pages/LoginPage.js";
import { requestMethod, requestPath, stubFetchMock } from "./fetchMock.js";

function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("LoginPage rate limiting (issue #91)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a distinct cooldown notice, disables submit, counts down, and re-enables on its own", async () => {
    const resetAt = Date.now() + 5_000;
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      if (path === "/auth/login" && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            429,
            {
              error: {
                code: "rate_limited",
                message: "Too many attempts. Try again once the cooldown ends.",
              },
              resetAt,
            },
            { "retry-after": "5" },
          ),
        );
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    render(
      <LoginPage onLoggedIn={() => undefined} theme="system" onCycleTheme={() => undefined} />,
    );

    fireEvent.change(screen.getByLabelText("Operator API key"), {
      target: { value: "wrong-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Queried by its copy, not by role: #94 keeps a second, permanently mounted
    // `role="alert"` on the form for rejected keys, so "the alert" is ambiguous.
    const announcement = await screen.findByText(
      /^Too many attempts\. Try again in \d+ seconds\.$/,
    );
    expect(announcement.getAttribute("role")).toBe("alert");
    // The status-report wording never reaches the operator verbatim.
    expect(screen.queryByText("Too many attempts. Try again once the cooldown ends.")).toBeNull();

    // Not the invalid-key treatment: the cooldown is a timer, not a failure, so
    // it may not carry Lamp Cut (DESIGN.md, The Quarantine Rule).
    const notice = document.querySelector(".rate-limit-notice");
    expect(notice).not.toBeNull();
    expect(notice?.classList.contains("error-text")).toBe(false);
    // The form's standing error line (#94) stays empty and the field stays
    // valid: a cooldown blames the clock, not the key that was typed.
    expect(document.querySelector(".error-text")?.textContent).toBe("");
    expect(screen.getByLabelText("Operator API key").getAttribute("aria-invalid")).toBe("false");

    // The per-source-IP consequence lives in its own advisory, not inside the error string.
    expect(screen.getByText(/shared by everyone signing in from this network/)).toBeTruthy();

    const button = screen.getByRole("button", { name: /Try again in/ });
    expect(button).toHaveProperty("disabled", true);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    // The visible countdown ticks…
    expect(document.querySelector(".rate-limit-countdown")?.textContent).toMatch(/^0:0[23]$/);
    // …while the assertive announcement holds still, so a screen reader states
    // the cooldown once instead of reciting it every second it runs.
    expect(announcement.textContent).toMatch(/Try again in 5 seconds\./);

    await act(async () => {
      vi.advanceTimersByTime(3_100);
    });

    const reenabled = await screen.findByRole("button", { name: "Sign in" });
    expect(reenabled).toHaveProperty("disabled", false);
    // The whole cooldown region unmounts, announcement included, so nothing is
    // left for a screen reader to re-read once the window has passed.
    expect(document.querySelector(".rate-limit-notice")).toBeNull();
    expect(screen.queryByText(/Too many attempts/)).toBeNull();
  });
});
