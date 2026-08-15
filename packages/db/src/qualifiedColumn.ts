import { getTableName, sql, type Column, type SQL } from "drizzle-orm";

/**
 * A `"table"."column"` reference that renders the same in every clause.
 *
 * Interpolating a Drizzle column object into a raw `sql` fragment qualifies it
 * in `WHERE` and `ORDER BY` but leaves it *bare* in a `SELECT` list. The
 * ranking queries in this package deliberately build each ordering fragment
 * once and reuse it verbatim across `SELECT`, `WHERE` and `ORDER BY`, so a
 * fragment that renders differently per clause is a correctness bug, not a
 * style one:
 *
 * - In `channels.ts` the fragments contain a correlated subquery, so a bare
 *   `"channel_id" = "id"` would rebind to the subquery's own table
 *   (`endpoint.channel_id = endpoint.id`), making the subquery match
 *   everything or nothing in the `SELECT` list alone. `ORDER BY` would then
 *   rank correctly while the value handed to the cursor said otherwise, and
 *   Channels would vanish or repeat at the first page boundary.
 * - In `endpoints.ts` the roll-up's rank legs join two tables, so a bare
 *   column name is ambiguous the moment both tables carry it.
 *
 * Qualifying explicitly removes the clause-dependence rather than relying on
 * it. Shared by both callers so the two can never drift apart.
 */
export function qualified(column: Column): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
