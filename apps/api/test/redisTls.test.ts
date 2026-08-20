import { describe, expect, it } from "vitest";
import { resolveRedisConnectionOptions, resolveRedisTls } from "../src/redisTls.js";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
const PLAINTEXT_URL = "redis://u:p@redis.example.com:6379";
const TLS_URL = "rediss://u:p@redis.example.com:6380";

describe("resolveRedisTls", () => {
  it("redis:// is plaintext, regardless of a configured CA", () => {
    expect(resolveRedisTls(PLAINTEXT_URL)).toEqual({});
    expect(resolveRedisTls(PLAINTEXT_URL, PEM)).toEqual({});
  });

  it("rediss:// with no CA encrypts but does not verify the server certificate", () => {
    expect(resolveRedisTls(TLS_URL)).toEqual({ tls: { rejectUnauthorized: false } });
  });

  it("rediss:// with a CA encrypts and pins verification to it", () => {
    expect(resolveRedisTls(TLS_URL, PEM)).toEqual({ tls: { ca: PEM, rejectUnauthorized: true } });
  });

  it("treats an empty CA cert as unset, not pinning an empty trust store", () => {
    expect(resolveRedisTls(TLS_URL, "")).toEqual({ tls: { rejectUnauthorized: false } });
  });

  it("normalizes a literal \\n-escaped PEM into real newlines", () => {
    const escaped = "-----BEGIN CERTIFICATE-----\\nMIIB...\\n-----END CERTIFICATE-----";
    expect(resolveRedisTls(TLS_URL, escaped)).toEqual({
      tls: { ca: PEM, rejectUnauthorized: true },
    });
  });
});

describe("resolveRedisConnectionOptions", () => {
  it("carries the url alongside the resolved tls config", () => {
    expect(resolveRedisConnectionOptions(PLAINTEXT_URL)).toEqual({ url: PLAINTEXT_URL });
    expect(resolveRedisConnectionOptions(TLS_URL, PEM)).toEqual({
      url: TLS_URL,
      tls: { ca: PEM, rejectUnauthorized: true },
    });
  });
});
