import { describe, expect, it } from "vitest";
import { ConflictingDatabaseSslConfigError, resolveDatabaseSsl } from "../src/ssl.js";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
const URL_NO_TLS = "postgres://u:p@db.example.com:5432/app";

describe("resolveDatabaseSsl", () => {
  it("returns undefined when no CA cert is configured, leaving DATABASE_URL to decide TLS", () => {
    expect(resolveDatabaseSsl(URL_NO_TLS)).toBeUndefined();
    expect(resolveDatabaseSsl(`${URL_NO_TLS}?sslmode=require&uselibpqcompat=true`)).toBeUndefined();
  });

  it("pins verification to the given CA, rejecting an unverifiable server", () => {
    expect(resolveDatabaseSsl(URL_NO_TLS, PEM)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("normalizes a literal \\n-escaped PEM into real newlines", () => {
    const escaped = "-----BEGIN CERTIFICATE-----\\nMIIB...\\n-----END CERTIFICATE-----";
    expect(resolveDatabaseSsl(URL_NO_TLS, escaped)).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    });
  });

  it("treats an empty CA cert as unset rather than pinning an empty trust store", () => {
    expect(resolveDatabaseSsl(URL_NO_TLS, "")).toBeUndefined();
  });

  // A pinned CA passed alongside any ssl* URL parameter is silently
  // discarded by pg, which re-parses the connection string after merging
  // explicit config. Refuse the combination instead of connecting with
  // TLS the deployment did not ask for.
  it.each(["sslmode=require", "sslrootcert=/etc/ca.pem", "ssl=true", "sslnegotiation=direct"])(
    "refuses a pinned CA when DATABASE_URL carries %s",
    (param) => {
      expect(() => resolveDatabaseSsl(`${URL_NO_TLS}?${param}`, PEM)).toThrow(
        ConflictingDatabaseSslConfigError,
      );
    },
  );

  it("names the offending parameters in the conflict error", () => {
    expect(() => resolveDatabaseSsl(`${URL_NO_TLS}?sslmode=require&sslcert=/c.pem`, PEM)).toThrow(
      /sslmode, sslcert/,
    );
  });

  it("ignores non-TLS query parameters when a CA is pinned", () => {
    expect(resolveDatabaseSsl(`${URL_NO_TLS}?application_name=migrate`, PEM)).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    });
  });

  it("leaves an unparseable connection string for pg to reject", () => {
    expect(resolveDatabaseSsl("not a url", PEM)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });
});
