import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { resetAdminFetchClientForTests } from "@webhook-broadcast/contract/client";
import { createQueryClient } from "../src/lib/queryClient.js";
import { AppRoutes } from "../src/routes.js";

export function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** Normalized pathname for openapi-fetch mocks (Request objects, relative URLs). */
export function requestPath(input: string | URL | Request): string {
  return new URL(requestUrl(input), "http://localhost").pathname;
}

export function requestMethod(input: string | URL | Request, init?: RequestInit): string {
  if (init?.method) {
    return init.method;
  }
  if (typeof input !== "string" && !(input instanceof URL) && input.method) {
    return input.method;
  }
  return "GET";
}

export function stubFetchMock(fetchMock: ReturnType<typeof vi.fn>): void {
  resetAdminFetchClientForTests();
  vi.stubGlobal("fetch", fetchMock);
}

/**
 * Renders the app's own route table (issue #42: Channel id, tab, and expanded
 * Broadcast live in the URL) so page components see real `useParams` and
 * `useNavigate` behavior instead of hand-wired props. Imports `AppRoutes`
 * rather than restating the routes, so this helper cannot drift from the app.
 */
export function renderRoutes(initialPath: string): RenderResult {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Read JSON request body from openapi-fetch's Request-first fetch calls. */
export async function readJsonBody(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<unknown> {
  if (typeof init?.body === "string") {
    return JSON.parse(init.body) as unknown;
  }
  if (input instanceof Request) {
    const text = await input.clone().text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
  return {};
}
