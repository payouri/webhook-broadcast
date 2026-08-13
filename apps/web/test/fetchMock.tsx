import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import { resetAdminFetchClientForTests } from "@webhook-broadcast/contract/client";
import { createQueryClient } from "../src/lib/queryClient.js";

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
 * ADR 0004 surfaces poll via TanStack Query — tests render them outside the
 * app's `QueryClientProvider`, so provide a fresh client per render (built
 * from the app's own factory, so options such as `retry: false` stay in sync).
 */
export function renderWithQueryClient(ui: ReactElement): RenderResult {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
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
