import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.google",
]);

export class UnsafeEndpointUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeEndpointUrlError";
  }
}

function parseIpv4Octets(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isBlockedIpv4(host: string): boolean {
  const octets = parseIpv4Octets(host);
  if (!octets) {
    return false;
  }
  const [a, b = -1] = octets;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 0) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) {
      return isBlockedIpv4(mapped);
    }
  }
  return false;
}

export function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  const ipKind = isIP(normalized);
  if (ipKind === 4) {
    return isBlockedIpv4(normalized);
  }
  if (ipKind === 6) {
    return isBlockedIpv6(normalized);
  }
  return false;
}

function assertAllowedProtocol(url: URL): void {
  if (url.protocol !== "https:") {
    throw new UnsafeEndpointUrlError("endpoint URL must use https");
  }
  if (url.username || url.password) {
    throw new UnsafeEndpointUrlError("endpoint URL must not embed credentials");
  }
}

function assertAllowedHostname(hostname: string): void {
  if (isBlockedHost(hostname)) {
    throw new UnsafeEndpointUrlError("endpoint URL targets a blocked host");
  }
}

/**
 * Rejects private, link-local, and metadata URLs before an Endpoint is
 * persisted. Performs a DNS lookup for hostnames so literal public names
 * cannot be repointed at internal addresses after validation.
 */
export async function assertSafeEndpointUrl(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new UnsafeEndpointUrlError("endpoint URL is invalid");
  }

  assertAllowedProtocol(url);
  assertAllowedHostname(url.hostname);

  if (isIP(url.hostname)) {
    return;
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new UnsafeEndpointUrlError("endpoint URL hostname did not resolve");
  }
  for (const record of records) {
    if (isBlockedHost(record.address)) {
      throw new UnsafeEndpointUrlError("endpoint URL resolves to a blocked address");
    }
  }
}
