/**
 * A failed migration reports through a one-shot task's stderr and nothing else
 * (issue #101), so that one line has to carry the whole causation chain.
 * drizzle raises a `DrizzleQueryError` naming the first statement it happened
 * to run — identical for every failure — while the driver error underneath it
 * holds what an operator can act on: the Postgres `code`/`severity`/`detail`/
 * `hint`, or the Node TLS/connect error for an unreachable host.
 */

/** Links past this many are summarised rather than logged, to bound the line. */
const MAX_CHAIN_LINKS = 8;

/** The `pg` driver hangs these on its errors; all are operator-actionable. */
const DIAGNOSTIC_FIELDS = ["code", "severity", "detail", "hint"] as const;

function readNonEmptyString(source: object, key: string): string | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringifyOpaque(value: object): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or otherwise unserialisable — the shape is all we can offer.
    return "[unserializable object]";
  }
}

/** One link of the chain: `Name: message (code=..., severity=...)`. */
function describeLink(value: NonNullable<unknown>): string {
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }
  if (typeof value !== "object") {
    return typeof value === "string" ? value.trim() || "(empty string)" : String(value);
  }

  const message = readNonEmptyString(value, "message");
  const name = readNonEmptyString(value, "name");

  let head: string;
  if (message === undefined) {
    // An AggregateError carries an empty message and all its content in
    // `errors`, so the name alone is the honest description of this link.
    head = name ?? stringifyOpaque(value);
  } else if (name === undefined || name === "Error" || message.startsWith(name)) {
    head = message;
  } else {
    head = `${name}: ${message}`;
  }

  const diagnostics = DIAGNOSTIC_FIELDS.flatMap((field) => {
    const detail = readNonEmptyString(value, field);
    return detail === undefined ? [] : [`${field}=${detail}`];
  });

  return diagnostics.length > 0 ? `${head} (${diagnostics.join(", ")})` : head;
}

/** Deeper errors reachable from one link: its `cause`, then any `errors`. */
function successorsOf(value: NonNullable<unknown>): unknown[] {
  if (typeof value !== "object") {
    return [];
  }
  const { cause, errors } = value as { cause?: unknown; errors?: unknown };
  return [
    ...(cause === undefined || cause === null ? [] : [cause]),
    ...(Array.isArray(errors) ? errors : []),
  ];
}

/**
 * Flatten an error and everything it was caused by into a single line, root
 * cause last. Cycles are visited once and the walk is depth-capped, so a
 * self-referential `cause` cannot hang the migration task it is reporting on.
 */
export function serializeErrorChain(error: unknown): string {
  const links: string[] = [];
  const seen = new WeakSet<object>();
  const pending: unknown[] = [error];

  while (pending.length > 0 && links.length < MAX_CHAIN_LINKS) {
    const current = pending.shift();
    if (current === undefined || current === null) {
      continue;
    }
    if (typeof current === "object" || typeof current === "function") {
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
    }
    links.push(describeLink(current));
    // Depth-first: a cause is closer to the root than a sibling `errors` entry.
    pending.unshift(...successorsOf(current));
  }

  const unreported = pending.filter(
    (value) =>
      value !== undefined &&
      value !== null &&
      !((typeof value === "object" || typeof value === "function") && seen.has(value)),
  );
  if (unreported.length > 0) {
    links.push(`... ${unreported.length} further cause(s) not shown`);
  }

  return links.length > 0 ? links.join(" -> ") : "Unknown error";
}
