// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRESHNESS_POLL_MS } from "../src/lib/freshness.js";
import {
  readJsonBody,
  renderRoutes,
  requestMethod,
  requestPath,
  stubFetchMock,
} from "./fetchMock.js";

const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const ENDPOINT_ID = "22222222-2222-2222-2222-222222222222";
const SECOND_ENDPOINT_ID = "44444444-4444-4444-4444-444444444444";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function channelBody() {
  return {
    id: CHANNEL_ID,
    slug: "orders",
    description: null,
    enabled: true,
    endpointCount: 1,
    hasBroadcasts: true,
    recentFailedDeliveryCount: 0,
    autoDisabledEndpointCount: 0,
    tokens: [],
    deletedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

interface EndpointJson {
  id: string;
  channelId: string;
  name: string | null;
  url: string;
  timeoutMs: number | null;
  headers: Record<string, string>;
  enabled: boolean;
  autoDisabledAt: string | null;
  successRate24h: number | null;
  p95Ms: number | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function endpointBody(overrides: Partial<EndpointJson> = {}): EndpointJson {
  return {
    id: ENDPOINT_ID,
    channelId: CHANNEL_ID,
    name: "Primary",
    url: "https://example.com/hook",
    timeoutMs: 5000,
    headers: {},
    enabled: true,
    autoDisabledAt: null,
    successRate24h: null,
    p95Ms: null,
    lastSuccessAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("Channel Detail — Endpoints tab", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let endpoints: Array<ReturnType<typeof endpointBody>>;

  beforeEach(() => {
    endpoints = [endpointBody()];
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return jsonResponse(200, channelBody());
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        return jsonResponse(200, { items: endpoints, nextCursor: null });
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "POST") {
        const body = (await readJsonBody(input, init)) as Partial<EndpointJson>;
        const created = endpointBody({
          id: "33333333-3333-3333-3333-333333333333",
          ...body,
        });
        endpoints = [...endpoints, created];
        return jsonResponse(201, created);
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` && method === "PATCH") {
        const patch = (await readJsonBody(input, init)) as Partial<EndpointJson>;
        const updated: EndpointJson = {
          ...endpoints[0]!,
          ...patch,
          // Mirrors `apps/api/src/admin/endpoints.ts`: setting `enabled: true`
          // clears `autoDisabledAt` server-side even though the client never
          // sends that field itself.
          ...(patch.enabled === true ? { autoDisabledAt: null } : {}),
        };
        endpoints = [updated, ...endpoints.slice(1)];
        return jsonResponse(200, updated);
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
    stubFetchMock(fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists existing Endpoints under the Endpoints tab", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));

    expect(await screen.findByText("Primary")).toBeTruthy();
    expect(screen.getByText("https://example.com/hook")).toBeTruthy();
  });

  it("shows auto-disabled state and health aggregates on the Endpoints tab", async () => {
    endpoints = [
      endpointBody({
        enabled: false,
        autoDisabledAt: "2026-08-10T12:00:00.000Z",
        successRate24h: 0.5,
        p95Ms: 120,
        lastSuccessAt: "2026-08-09T18:00:00.000Z",
      }),
    ];
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));

    expect(await screen.findByText("Auto-disabled")).toBeTruthy();
    expect(screen.getByText(/50% ok \(24h\)/)).toBeTruthy();
    expect(screen.getByText(/p95 120ms/)).toBeTruthy();
  });

  // Issue #88: the leading lamp used to report `enabled`, not health, so a
  // 100%-failing, still-enabled Endpoint wore the same green lamp as a
  // healthy one.
  it("reports health, not enabled-ness, on the leading lamp of a 100%-failing enabled Endpoint", async () => {
    endpoints = [endpointBody({ enabled: true, successRate24h: 0 })];
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));

    const row = (await screen.findByText("Primary")).closest("li")!;
    const badge = within(row).getByText("0% ok (24h)");
    expect(badge.className).toContain("lamp-cut");
    expect(badge.className).not.toContain("lamp-live");
    // And said once, by the lamp alone. The trailing statistics cell used to
    // print the same reading, so the row set the same machine string twice —
    // once in the column the eye runs without reading, once in the column that
    // truncates.
    expect(row.textContent?.match(/0% ok \(24h\)/g)).toHaveLength(1);
    // Enabled-ness is not gone, it moved: the row's own switch plate, still
    // checked, is what an operator reads and sets it from now.
    const enabledSwitch = within(row).getByRole("checkbox") as HTMLInputElement;
    expect(enabledSwitch.checked).toBe(true);
  });

  // The switch plate is the operator setting DESIGN.md's Switch plates
  // section already reserves for a boolean the operator *sets*, and it is
  // reachable — and operable — without opening the row's edit well.
  it("toggles Endpoint enabled-ness directly from the row's own switch plate", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    const row = (await screen.findByText("Primary")).closest("li")!;
    const enabledSwitch = within(row).getByRole("checkbox") as HTMLInputElement;
    expect(enabledSwitch.checked).toBe(true);

    fireEvent.click(enabledSwitch);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          if (
            requestPath(input) !== `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` ||
            requestMethod(input, init) !== "PATCH"
          ) {
            return false;
          }
          return true;
        }),
      ).toBe(true);
    });
    // The click never also opened the edit well: the switch is a sibling of
    // the row's button, not nested inside it.
    expect(screen.queryByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` })).toBeNull();

    await waitFor(() => {
      expect((within(row).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    });
  });

  it("spends the content column on the New Endpoint form instead of the prose measure", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));

    // Purely visual, so nothing else observable would fail if an edit dropped
    // it. The New Endpoint plate opts out of the 72ch prose cap; the form it
    // holds already pairs Name and Timeout, which is what a form plate owes the
    // width it takes (DESIGN.md §Plates and wells).
    const legend = Array.from(document.querySelectorAll(".section-title")).find(
      (node) => (node.textContent ?? "").trim() === "New Endpoint",
    );
    const plate = legend?.closest(".plate");
    expect(plate).toBeTruthy();
    expect(plate?.className).toContain("plate-wide");
    expect(plate?.querySelector(".field-pair")).toBeTruthy();
  });

  it("creates a new Endpoint from the Endpoints tab form", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    fireEvent.change(screen.getByLabelText("URL", { selector: "#endpoint-url-new" }), {
      target: { value: "https://example.com/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestPath(input) === `/channels/${CHANNEL_ID}/endpoints` &&
            requestMethod(input, init) === "POST",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("https://example.com/new")).toBeTruthy();
  });

  it("edits an existing Endpoint in place", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    fireEvent.click(await screen.findByText("Primary"));

    const nameInput = await screen.findByLabelText("Name", {
      selector: `#endpoint-name-${ENDPOINT_ID}`,
    });
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestPath(input) === `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` &&
            requestMethod(input, init) === "PATCH",
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("Renamed")).toBeTruthy();
  });

  // Issue #67: the New Endpoint form and an open edit well are two peers on one
  // screen, and only one of them may carry the filled primary treatment.
  it("keeps one filled primary while the Endpoint edit well is open", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    const addEndpoint = await screen.findByRole("button", { name: "Add Endpoint" });
    expect(addEndpoint.className).toContain("control-primary");

    fireEvent.click(await screen.findByText("Primary"));

    const saveChanges = await screen.findByRole("button", { name: "Save changes" });
    expect(saveChanges.className).toContain("control-commit");
    expect(saveChanges.className).not.toContain("control-primary");
    expect(addEndpoint.className).toContain("control-primary");
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.className.includes("control-primary")),
    ).toHaveLength(1);
  });

  // Issue #67: a dead control with no stated reason is worse than one that
  // explains itself when pressed, so submit disables only while a request is in
  // flight — never to express an empty URL.
  it("leaves Add Endpoint pressable with an empty URL", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const urlField = screen.getByLabelText("URL", { selector: "#endpoint-url-new" });
    expect((urlField as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByRole("button", { name: "Add Endpoint" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    // The emptiness is still caught, by the field's own constraint rather than
    // by a control the operator cannot press.
    expect(urlField.hasAttribute("required")).toBe(true);
  });

  it("states an Endpoint row's disclosure at rest and moves focus into the edit form on open", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    const row = (await screen.findByText("Primary")).closest("button")!;

    // The chevron and `aria-expanded` are shapes at rest (DESIGN.md #5 Rows),
    // not something discovered only once the row is clicked.
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.querySelector("svg")).toBeTruthy();

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("true");

    // The overlay focus contract (DESIGN.md #4): the swap moves focus onto
    // the region's first meaningful control, the URL field, rather than
    // leaving it on <body>.
    const urlInput = await screen.findByLabelText("URL", {
      selector: `#endpoint-url-${ENDPOINT_ID}`,
    });
    expect(document.activeElement).toBe(urlInput);

    // The row itself, its lamp and its name, stay visible while its form is
    // open below it (BroadcastDetailPanel's row-plus-well shape), rather than
    // the row being replaced outright.
    expect(screen.getByText("Primary")).toBeTruthy();
  });

  it("closes the Endpoint edit form on Escape, the same as Cancel, and returns focus to the row", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    fireEvent.click(await screen.findByText("Primary"));

    const urlInput = await screen.findByLabelText("URL", {
      selector: `#endpoint-url-${ENDPOINT_ID}`,
    });
    fireEvent.keyDown(urlInput, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` }),
      ).toBeNull();
    });
    const row = screen.getByText("Primary").closest("button")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    // Cancelling (Escape included) returns focus to the row that opened the
    // edit (issue #61), not to <body>.
    expect(document.activeElement).toBe(row);
  });

  it("returns focus to the Endpoint row when Cancel is pressed in the edit form", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    fireEvent.click(await screen.findByText("Primary"));

    await screen.findByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` }),
      ).toBeNull();
    });
    const row = screen.getByText("Primary").closest("button")!;
    expect(document.activeElement).toBe(row);
  });

  it("opens the Endpoint editor by clicking the disclosure chevron itself", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    const row = (await screen.findByText("Primary")).closest("button")!;
    const chevron = row.querySelector(".row-chevron svg")!;
    expect(chevron).toBeTruthy();

    // The chevron sits inside the row's own `<button>` (the whole row is the
    // control, per DESIGN.md #5 Rows), so a click landing on the glyph itself
    // reaches the same affordance as a click anywhere else on the row.
    fireEvent.click(chevron);

    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(
      await screen.findByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` }),
    ).toBeTruthy();
  });

  it("does not open the editor when re-enabling an auto-disabled Endpoint", async () => {
    endpoints = [
      endpointBody({
        enabled: false,
        autoDisabledAt: "2026-08-10T12:00:00.000Z",
      }),
    ];
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Auto-disabled");

    // The Re-enable control sits outside the row's own clickable region (a
    // sibling in the `<li>`, not nested inside the row `<button>`), so
    // pressing it must not also trigger the row's edit-open behavior.
    fireEvent.click(screen.getByRole("button", { name: "Re-enable" }));

    const row = screen.getByText("Primary").closest("button")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` })).toBeNull();
  });

  it("guards a row-to-row switch against silently discarding unsaved changes", async () => {
    endpoints = [
      endpointBody(),
      endpointBody({ id: SECOND_ENDPOINT_ID, name: "Secondary", url: "https://example.com/two" }),
    ];
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    fireEvent.click(await screen.findByText("Primary"));

    const nameInput = await screen.findByLabelText("Name", {
      selector: `#endpoint-name-${ENDPOINT_ID}`,
    });
    fireEvent.change(nameInput, { target: { value: "Renamed" } });

    // Clicking a different Endpoint row while the open one is dirty must not
    // silently discard the edit in progress.
    fireEvent.click(screen.getByText("Secondary"));

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "p" &&
          /Unsaved changes to Primary\. Discard them and edit Secondary/.test(
            element.textContent ?? "",
          ),
      ),
    ).toBeTruthy();
    // The Primary form is still there, still holding the unsaved rename: the
    // confirm names what would be lost rather than unmounting the form (and
    // its local state) to make room for itself.
    expect((nameInput as HTMLInputElement).value).toBe("Renamed");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    const nameInputAgain = await screen.findByLabelText("Name", {
      selector: `#endpoint-name-${ENDPOINT_ID}`,
    });
    expect((nameInputAgain as HTMLInputElement).value).toBe("Renamed");

    // Now actually discard and switch.
    fireEvent.click(screen.getByText("Secondary"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard and switch" }));

    expect(
      await screen.findByLabelText("URL", { selector: `#endpoint-url-${SECOND_ENDPOINT_ID}` }),
    ).toBeTruthy();
    expect(
      screen.queryByLabelText("Name", { selector: `#endpoint-name-${ENDPOINT_ID}` }),
    ).toBeNull();
  });

  it("polls Endpoints every ~5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const endpointCalls = () =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestPath(input) === `/channels/${CHANNEL_ID}/endpoints` &&
          requestMethod(input, init) === "GET",
      ).length;

    await act(async () => {
      await Promise.resolve();
    });
    const initialCalls = endpointCalls();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRESHNESS_POLL_MS);
    });
    expect(endpointCalls()).toBe(initialCalls + 1);
  });

  it("explains an auto-disabled Endpoint and offers a direct re-enable action", async () => {
    endpoints = [
      endpointBody({
        enabled: false,
        autoDisabledAt: "2026-08-10T12:00:00.000Z",
      }),
    ];
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Auto-disabled");

    // Names the failure streak, the (unnumbered) threshold, and states it
    // does not recover on its own — never entering edit mode to say so.
    expect(screen.getByText(/failure streak/i)).toBeTruthy();
    expect(screen.getByText(/configured auto-disable window/i)).toBeTruthy();
    expect(screen.getByText(/does not recover on its own/i)).toBeTruthy();
    expect(screen.queryByLabelText("URL", { selector: `#endpoint-url-${ENDPOINT_ID}` })).toBeNull();

    // It says so as an advisory, not in the destructive confirm-region
    // treatment (issue #67): an informational notice may not read identically
    // to "Confirm delete".
    const notice = screen.getByText(/failure streak/i).closest("p")!;
    expect(notice.className).toContain("advisory");
    expect(notice.closest(".confirm-region")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Re-enable" }));

    await waitFor(() => {
      expect(
        // The body is asserted by outcome rather than by reading it back: the
        // mock only clears `autoDisabledAt` when the patch carries
        // `enabled: true`, so the row flipping to Enabled below can only
        // happen if that is what was sent.
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestPath(input) === `/channels/${CHANNEL_ID}/endpoints/${ENDPOINT_ID}` &&
            requestMethod(input, init) === "PATCH",
        ),
      ).toBe(true);
    });

    // The row returns to a healthy presentation without a manual refresh. The
    // lamp now reports health rather than `enabled` (issue #88): with no
    // Deliveries recorded yet (`successRate24h` stays `null` in this fixture),
    // that reads "No activity (24h)", not "Enabled" — the row's own switch
    // plate is what shows enabled-ness now.
    await waitFor(() => {
      expect(screen.queryByText("Auto-disabled")).toBeNull();
    });
    const row = within(screen.getByText("Primary").closest("li")!);
    expect(row.getByText("No activity (24h)")).toBeTruthy();
    expect((row.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "Re-enable" })).toBeNull();
  });

  // Issue #71: the URL and Headers fields validate locally against the
  // contract's own schemas (DESIGN.md §5's Reward-Early-Punish-Late Rule),
  // rather than sending a malformed value the server was always going to
  // 400 on.
  it("is silent on a malformed URL until the field is left, then marks it in the schema's own words", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const urlInput = screen.getByLabelText("URL", { selector: "#endpoint-url-new" });
    fireEvent.change(urlInput, { target: { value: "not a url" } });
    // Silent on first pass: half of a URL is not a URL either, so a field
    // showing an error for most of the time it takes to type one would be
    // punishing early rather than late.
    expect(document.getElementById("endpoint-url-new-error")).toBeNull();
    expect(urlInput.getAttribute("aria-invalid")).toBe("false");

    fireEvent.blur(urlInput);
    const error = document.getElementById("endpoint-url-new-error");
    // The constraint in the system's own voice (DESIGN.md §5 Fields — Error),
    // which is the schema's own message, not Zod's default "Invalid URL".
    expect(error?.textContent).toContain(
      "URL must be a full URL including the scheme (e.g. https://example.com/webhook)",
    );
    expect(urlInput.getAttribute("aria-invalid")).toBe("true");
    expect(urlInput.getAttribute("aria-describedby")).toBe("endpoint-url-new-error");

    // Live once marked: correcting it clears the error on the very keystroke
    // that fixes it, no round trip required.
    fireEvent.change(urlInput, { target: { value: "https://example.com/hook" } });
    expect(document.getElementById("endpoint-url-new-error")).toBeNull();
    expect(urlInput.getAttribute("aria-invalid")).toBe("false");
  });

  // Issue #87: the contract's max on `timeoutMs` (ADR 0015) is enforced here
  // too, in the contract schema's own words.
  it("is silent on an absurd Timeout until the field is left, then marks it in the schema's own words", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const timeoutInput = screen.getByLabelText("Timeout (ms)", {
      selector: "#endpoint-timeout-new",
    });
    fireEvent.change(timeoutInput, { target: { value: "3600001" } });
    expect(document.getElementById("endpoint-timeout-new-error")).toBeNull();
    expect(timeoutInput.getAttribute("aria-invalid")).toBe("false");

    fireEvent.blur(timeoutInput);
    const error = document.getElementById("endpoint-timeout-new-error");
    expect(error?.textContent).toContain(
      "Timeout must be at most 3600000ms (1h) — past that, one slow Attempt stalls the rest of the Channel's fan-out",
    );
    expect(timeoutInput.getAttribute("aria-invalid")).toBe("true");
    expect(timeoutInput.getAttribute("aria-describedby")).toBe("endpoint-timeout-new-error");

    fireEvent.change(timeoutInput, { target: { value: "5000" } });
    expect(document.getElementById("endpoint-timeout-new-error")).toBeNull();
    expect(timeoutInput.getAttribute("aria-invalid")).toBe("false");
  });

  // The max is not the only rule on `timeoutMs`, and `0` and `1.5` are both
  // reachable from a `type="number"` field. Unmessaged they would reach the
  // operator as Zod's "Too small: expected number to be >=1" and "Invalid
  // input: expected int, received number" — the phrasing DESIGN.md §5
  // Fields — Error rules out.
  it.each([
    ["0", "Timeout must be at least 1ms"],
    ["1.5", "Timeout must be a whole number of milliseconds"],
  ])("states the Timeout rule broken by %s in the system's own voice", async (value, message) => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const timeoutInput = screen.getByLabelText("Timeout (ms)", {
      selector: "#endpoint-timeout-new",
    });
    fireEvent.change(timeoutInput, { target: { value } });
    fireEvent.blur(timeoutInput);

    const error = document.getElementById("endpoint-timeout-new-error");
    expect(error?.textContent).toContain(message);
    expect(error?.textContent).not.toContain("Invalid input");
    expect(error?.textContent).not.toContain("Too small");
  });

  it('refuses {"a": 1} as Headers in the browser, which the old hand-rolled check let through', async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    const headersInput = screen.getByLabelText("Headers (JSON)", {
      selector: "#endpoint-headers-new",
    });
    fireEvent.change(headersInput, { target: { value: '{"a": 1}' } });
    expect(document.getElementById("endpoint-headers-new-error")).toBeNull();

    fireEvent.blur(headersInput);
    const error = document.getElementById("endpoint-headers-new-error");
    // The contract's own record<string,string> message, named in the system's
    // own voice rather than Zod's "expected string, received number" — and,
    // unlike the old hand-rolled check, this rejects the value at all.
    expect(error?.textContent).toContain(
      'Headers must be a JSON object of string values (e.g. {"x-api-key": "secret"})',
    );
    expect(headersInput.getAttribute("aria-invalid")).toBe("true");
  });

  it("marks every invalid field at once on submit and moves focus to the first of them", async () => {
    renderRoutes(`/channels/${CHANNEL_ID}`);

    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));
    await screen.findByText("Primary");

    fireEvent.change(screen.getByLabelText("URL", { selector: "#endpoint-url-new" }), {
      target: { value: "not a url" },
    });
    fireEvent.change(
      screen.getByLabelText("Headers (JSON)", { selector: "#endpoint-headers-new" }),
      { target: { value: '{"a": 1}' } },
    );
    // Neither field has been touched yet: both are still silent.
    expect(document.getElementById("endpoint-url-new-error")).toBeNull();
    expect(document.getElementById("endpoint-headers-new-error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));

    expect(document.getElementById("endpoint-url-new-error")).toBeTruthy();
    expect(document.getElementById("endpoint-headers-new-error")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText("URL", { selector: "#endpoint-url-new" }),
    );
    // Never sent: the request the server was certain to 400 stayed home.
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestPath(input) === `/channels/${CHANNEL_ID}/endpoints` &&
          requestMethod(input, init) === "POST",
      ),
    ).toBe(false);
    // Not disabled to express invalidity: pressing it while invalid is what
    // forces the messages onto the screen, rather than the control going dead.
    expect(
      (screen.getByRole("button", { name: "Add Endpoint" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows a Retry control when Endpoints fail to load", async () => {
    let shouldFail = true;

    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);

      if (path === `/channels/${CHANNEL_ID}` && method === "GET") {
        return jsonResponse(200, channelBody());
      }
      if (path === `/channels/${CHANNEL_ID}/broadcasts` && method === "GET") {
        return jsonResponse(200, { items: [], nextCursor: null });
      }
      if (path === `/channels/${CHANNEL_ID}/endpoints` && method === "GET") {
        if (shouldFail) {
          return jsonResponse(500, { error: { message: "server down" } });
        }
        return jsonResponse(200, { items: endpoints, nextCursor: null });
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });

    renderRoutes(`/channels/${CHANNEL_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Endpoints" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    shouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Primary")).toBeTruthy();
  });
});
