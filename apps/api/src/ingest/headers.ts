import type { IncomingHttpHeaders } from "node:http";

export function parseHeaderList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Applies the env allow/deny filter to inbound headers before they're
 * persisted on the Broadcast (ADR 0002; empty allowlist = keep everything).
 * Denylist wins over allowlist so a header can never be let back in by
 * misconfiguring both lists with an overlapping entry.
 */
export function filterHeaders(
  headers: IncomingHttpHeaders,
  allowlist: string[],
  denylist: string[],
): Record<string, string | string[]> {
  const allowSet = new Set(allowlist.map((entry) => entry.toLowerCase()));
  const denySet = new Set(denylist.map((entry) => entry.toLowerCase()));

  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    const lowerKey = key.toLowerCase();
    if (denySet.has(lowerKey)) {
      continue;
    }
    if (allowSet.size > 0 && !allowSet.has(lowerKey)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
