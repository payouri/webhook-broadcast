import { describe, expect, it } from "vitest";
import {
  DEFAULT_INGEST_HEADER_DENYLIST,
  filterHeaders,
  mergeIngestHeaderDenylist,
} from "../src/ingest/headers.js";

describe("mergeIngestHeaderDenylist", () => {
  it("includes sensitive headers by default", () => {
    expect(mergeIngestHeaderDenylist([])).toEqual(
      expect.arrayContaining([...DEFAULT_INGEST_HEADER_DENYLIST]),
    );
  });

  it("merges env-configured entries without duplicates", () => {
    expect(mergeIngestHeaderDenylist(["authorization", "x-secret"])).toEqual(
      expect.arrayContaining(["authorization", "x-secret"]),
    );
    expect(
      mergeIngestHeaderDenylist(["authorization", "x-secret"]).filter((h) => h === "authorization"),
    ).toHaveLength(1);
  });
});

describe("filterHeaders", () => {
  it("drops default-denied authorization and cookie headers", () => {
    const filtered = filterHeaders(
      {
        authorization: "Bearer secret",
        cookie: "session=abc",
        "content-type": "application/json",
      },
      [],
      mergeIngestHeaderDenylist([]),
    );

    expect(filtered).toEqual({ "content-type": "application/json" });
  });
});
