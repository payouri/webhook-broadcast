import { describe, expect, it } from "vitest";
import {
  UnsafeEndpointUrlError,
  assertSafeEndpointUrl,
  isBlockedHost,
} from "../src/endpointUrl.js";

describe("isBlockedHost", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "localhost",
    "metadata.google.internal",
    "app.local",
    "host.localhost",
    "::1",
    "fe80::1",
    "fd12::1",
  ])("blocks %s", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it("allows a public hostname literal", () => {
    expect(isBlockedHost("example.com")).toBe(false);
  });
});

describe("assertSafeEndpointUrl", () => {
  it("accepts a public https URL", async () => {
    await expect(assertSafeEndpointUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("rejects non-https URLs", async () => {
    await expect(assertSafeEndpointUrl("http://example.com/hook")).rejects.toThrow(
      UnsafeEndpointUrlError,
    );
  });

  it("rejects localhost targets", async () => {
    await expect(assertSafeEndpointUrl("https://127.0.0.1/hook")).rejects.toThrow(/blocked host/i);
  });

  it("rejects cloud metadata endpoints", async () => {
    await expect(assertSafeEndpointUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /blocked host/i,
    );
  });

  it("rejects embedded credentials", async () => {
    await expect(assertSafeEndpointUrl("https://user:pass@example.com/hook")).rejects.toThrow(
      /credentials/i,
    );
  });
});
