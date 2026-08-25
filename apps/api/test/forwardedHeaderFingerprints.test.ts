import { describe, expect, it } from "vitest";
import { fingerprintForwardedHeaders } from "../src/admin/forwardedHeaderFingerprints.js";
import { sha256Prefix } from "./sha256Prefix.js";

describe("fingerprintForwardedHeaders (issue #112)", () => {
  it("returns undefined — an absent field — when the Channel declares no forwardHeaders", () => {
    expect(
      fingerprintForwardedHeaders({ "x-unipile-webhook-secret": "s3cret" }, []),
    ).toBeUndefined();
  });

  it("returns undefined for an allow-list that survives normalisation to nothing", () => {
    expect(fingerprintForwardedHeaders({ "x-secret": "s3cret" }, ["   ", ""])).toBeUndefined();
  });

  it("returns the name and a 12-hex-char SHA-256 prefix of the forwarded value", () => {
    expect(
      fingerprintForwardedHeaders({ "x-unipile-webhook-secret": "s3cret" }, [
        "x-unipile-webhook-secret",
      ]),
    ).toEqual([{ name: "x-unipile-webhook-secret", fingerprint: sha256Prefix("s3cret") }]);
  });

  it("never returns the raw value", () => {
    const [entry] = fingerprintForwardedHeaders({ "x-secret": "s3cret" }, ["x-secret"]) ?? [];
    expect(JSON.stringify(entry)).not.toContain("s3cret");
    expect(entry?.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it("distinguishes a rotated secret from the one the producer still presents", () => {
    const stale = fingerprintForwardedHeaders({ "x-secret": "old-derived" }, ["x-secret"]);
    const current = fingerprintForwardedHeaders({ "x-secret": "new-derived" }, ["x-secret"]);
    expect(stale?.[0]?.fingerprint).not.toBe(current?.[0]?.fingerprint);
  });

  it("is stable for the same value, so two Broadcasts are comparable", () => {
    expect(fingerprintForwardedHeaders({ "x-secret": "same" }, ["x-secret"])).toEqual(
      fingerprintForwardedHeaders({ "x-secret": "same" }, ["x-secret"]),
    );
  });

  it("fingerprints only the declared headers, ignoring everything else stored", () => {
    expect(
      fingerprintForwardedHeaders(
        { "x-secret": "s3cret", "x-other": "nope", "content-type": "application/json" },
        ["x-secret"],
      )?.map((entry) => entry.name),
    ).toEqual(["x-secret"]);
  });

  it("preserves the stored casing and matches the allow-list case-insensitively", () => {
    expect(fingerprintForwardedHeaders({ "X-Secret": "s3cret" }, ["x-secret"])).toEqual([
      { name: "X-Secret", fingerprint: sha256Prefix("s3cret") },
    ]);
  });

  it("fingerprints the comma-joined value the delivery path actually forwards", () => {
    expect(fingerprintForwardedHeaders({ "x-multi": ["a", "b"] }, ["x-multi"])).toEqual([
      { name: "x-multi", fingerprint: sha256Prefix("a, b") },
    ]);
  });

  it("never fingerprints authorization, matching the delivery-time backstop", () => {
    expect(
      fingerprintForwardedHeaders(
        { authorization: "Bearer channel-ingest-token", "x-secret": "s" },
        ["authorization", "x-secret"],
      )?.map((entry) => entry.name),
    ).toEqual(["x-secret"]);
  });

  it("treats an allow-list of only authorization as forwarding nothing at all", () => {
    expect(
      fingerprintForwardedHeaders({ authorization: "Bearer channel-ingest-token" }, [
        "authorization",
      ]),
    ).toBeUndefined();
  });

  it("returns an empty list when a declared header was never stored (ADR 0016 bound)", () => {
    expect(
      fingerprintForwardedHeaders({ "content-type": "application/json" }, ["x-api-key"]),
    ).toEqual([]);
  });

  it("orders entries by name so two Broadcasts diff by eye", () => {
    expect(
      fingerprintForwardedHeaders({ "x-zulu": "1", "x-alpha": "2" }, ["x-zulu", "x-alpha"])?.map(
        (entry) => entry.name,
      ),
    ).toEqual(["x-alpha", "x-zulu"]);
  });
});
