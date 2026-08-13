import { describe, expect, it } from "vitest";
import { filterHeaders, mergeIngestHeaderDenylist } from "../src/ingest/headers.js";
import { selectForwardableHeaders } from "../src/worker/forwardHeaders.js";

describe("selectForwardableHeaders", () => {
  it("forwards nothing when the allow-list is empty (default, unchanged behaviour)", () => {
    expect(
      selectForwardableHeaders({ "x-signature": "abc", "content-type": "application/json" }, []),
    ).toEqual({});
  });

  it("forwards only the allow-listed inbound headers", () => {
    expect(
      selectForwardableHeaders(
        { "x-signature": "abc", "x-other": "nope", "content-type": "application/json" },
        ["x-signature"],
      ),
    ).toEqual({ "x-signature": "abc" });
  });

  it("matches header names case-insensitively", () => {
    expect(selectForwardableHeaders({ "X-Signature": "abc" }, ["x-signature"])).toEqual({
      "X-Signature": "abc",
    });
  });

  it("joins a multi-value stored header with a comma", () => {
    expect(selectForwardableHeaders({ "x-multi": ["a", "b"] }, ["x-multi"])).toEqual({
      "x-multi": "a, b",
    });
  });

  it("never forwards authorization even if named on the allow-list", () => {
    expect(
      selectForwardableHeaders({ authorization: "Bearer channel-ingest-token" }, ["authorization"]),
    ).toEqual({});
  });

  it("never forwards Authorization regardless of case in either the header or the allow-list entry", () => {
    expect(selectForwardableHeaders({ Authorization: "Bearer secret" }, ["AUTHORIZATION"])).toEqual(
      {},
    );
  });

  it("is unaffected by header names not present on the Broadcast", () => {
    expect(selectForwardableHeaders({}, ["x-signature"])).toEqual({});
  });
});

/**
 * The allow-list can only select from what ADR 0002's ingest filter already
 * persisted, so it is bounded by `DEFAULT_INGEST_HEADER_DENYLIST` and cannot
 * widen it. Pins that boundary: naming a default-denied credential header is
 * accepted at configuration time but forwards nothing, because the header was
 * never stored on the Broadcast. See ADR 0010.
 */
describe("forwardHeaders is bounded by the ingest header denylist (ADR 0002)", () => {
  it("forwards nothing for a default-denied credential header the sender did present", () => {
    const stored = filterHeaders(
      { "x-api-key": "sender-credential", "x-signature": "abc" },
      [],
      mergeIngestHeaderDenylist([]),
    );

    expect(stored["x-api-key"]).toBeUndefined();
    expect(selectForwardableHeaders(stored, ["x-api-key", "x-signature"])).toEqual({
      "x-signature": "abc",
    });
  });
});
