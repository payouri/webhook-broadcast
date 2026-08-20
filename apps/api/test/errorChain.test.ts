import { describe, expect, it } from "vitest";
import { serializeErrorChain } from "../src/errorChain.js";

/** The shape drizzle-kit raises: statement head, driver error as `cause`. */
function drizzleQueryError(cause: unknown): Error {
  const error = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: ', {
    cause,
  });
  error.name = "DrizzleQueryError";
  return error;
}

describe("serializeErrorChain (migration failure reporting)", () => {
  it("reports the driver cause, not just the statement drizzle ran first", () => {
    const cause = Object.assign(new Error('password authentication failed for user "app"'), {
      name: "error",
      code: "28P01",
      severity: "FATAL",
    });

    const line = serializeErrorChain(drizzleQueryError(cause));

    expect(line).toContain('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    expect(line).toContain("password authentication failed");
    expect(line).toContain("code=28P01");
    expect(line).toContain("severity=FATAL");
  });

  it("keeps the head error's type name, which String(error) also carried", () => {
    expect(serializeErrorChain(drizzleQueryError(undefined))).toMatch(/^DrizzleQueryError: /);
  });

  it("does not prefix a plain Error with a redundant name", () => {
    expect(serializeErrorChain(new Error("boom"))).toBe("boom");
  });

  it("carries every pg diagnostic field the operator can act on", () => {
    const cause = Object.assign(new Error("permission denied for schema public"), {
      code: "42501",
      severity: "ERROR",
      detail: 'role "app" lacks CREATE',
      hint: "GRANT CREATE ON SCHEMA public TO app",
    });

    const line = serializeErrorChain(drizzleQueryError(cause));

    expect(line).toContain("code=42501");
    expect(line).toContain("severity=ERROR");
    expect(line).toContain('detail=role "app" lacks CREATE');
    expect(line).toContain("hint=GRANT CREATE ON SCHEMA public TO app");
  });

  it("walks a multi-level chain root-cause last", () => {
    const root = new Error("self signed certificate in certificate chain");
    const middle = new Error("connection terminated", { cause: root });

    expect(serializeErrorChain(drizzleQueryError(middle))).toBe(
      'DrizzleQueryError: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: -> ' +
        "connection terminated -> self signed certificate in certificate chain",
    );
  });

  it("unpacks an AggregateError, whose own message is empty", () => {
    const aggregate = new AggregateError(
      [
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
        Object.assign(new Error("connect ECONNREFUSED ::1:5432"), { code: "ECONNREFUSED" }),
      ],
      "",
    );

    const line = serializeErrorChain(drizzleQueryError(aggregate));

    expect(line).toContain("AggregateError");
    expect(line).toContain("127.0.0.1:5432 (code=ECONNREFUSED)");
    expect(line).toContain("::1:5432 (code=ECONNREFUSED)");
  });

  it("terminates on a self-referential cause instead of hanging the task", () => {
    const cyclic: Error & { cause?: unknown } = new Error("cyclic");
    cyclic.cause = cyclic;

    expect(serializeErrorChain(cyclic)).toBe("cyclic");
  });

  it("terminates on a mutual cause cycle", () => {
    const first: Error & { cause?: unknown } = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    expect(serializeErrorChain(first)).toBe("first -> second");
  });

  it("caps a runaway chain rather than emitting an unbounded log line", () => {
    let error = new Error("link-0");
    for (let index = 1; index < 40; index += 1) {
      error = new Error(`link-${index}`, { cause: error });
    }

    const line = serializeErrorChain(error);

    expect(line.startsWith("link-39 -> link-38")).toBe(true);
    expect(line).toContain("further cause(s) not shown");
    expect(line).not.toContain("link-0");
  });

  it("handles non-Error rejection values", () => {
    expect(serializeErrorChain("just a string")).toBe("just a string");
    expect(serializeErrorChain({ message: "duck-typed" })).toBe("duck-typed");
    expect(serializeErrorChain({ nope: 1 })).toBe('{"nope":1}');
    expect(serializeErrorChain(undefined)).toBe("Unknown error");
    expect(serializeErrorChain(null)).toBe("Unknown error");
    expect(serializeErrorChain(42)).toBe("42");
  });
});
