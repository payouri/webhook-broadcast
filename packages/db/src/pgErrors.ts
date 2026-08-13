/** Postgres unique_violation SQLSTATE (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
export const UNIQUE_VIOLATION = "23505";

/** Postgres check_violation SQLSTATE (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
export const CHECK_VIOLATION = "23514";

export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  // drizzle-orm wraps the driver error as `DrizzleQueryError` with the
  // original `pg` error (carrying the SQLSTATE `code`) on `.cause`.
  if ("cause" in error) {
    return pgErrorCode(error.cause);
  }
  return undefined;
}

/** Postgres reports the violated constraint's name on `.constraint`; walk `.cause` the same way `pgErrorCode` does. */
export function pgConstraintName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("constraint" in error && typeof error.constraint === "string") {
    return error.constraint;
  }
  if ("cause" in error) {
    return pgConstraintName(error.cause);
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}

export function isCheckViolation(error: unknown, constraintName: string): boolean {
  return pgErrorCode(error) === CHECK_VIOLATION && pgConstraintName(error) === constraintName;
}
