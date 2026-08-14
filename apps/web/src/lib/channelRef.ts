/**
 * A Channel route segment holds one of two forms (issue #56):
 *
 * - The **id** (a UUID) — permanent, assigned once at creation and never
 *   reused or changed. Immune to a slug rename, so it is the durable form to
 *   hand someone when a link needs to keep working indefinitely.
 * - The **slug** — human-typed and directory-linked, e.g. `stripe-prod`.
 *   Readable and reconstructable from memory, which a UUID is not.
 *
 * Both forms resolve to the same Channel and neither is rewritten in the
 * address bar: visiting a UUID URL stays on that UUID, visiting a slug URL
 * stays on that slug. The one rule every Channel route follows (this file,
 * `useChannelRouteId` in `channelQuery.ts`, and `ChannelDirectoryPage`) is
 * that the *directory* always links the slug form — it is what an operator can
 * read off the row and reconstruct later, so that is the shape new links take.
 *
 * The one time the address bar does change is a rename of the slug it is
 * currently holding (`ChannelDetailPage`'s `followSlugRename`): the route
 * follows the Channel to its new slug, since the alternative is the operator
 * watching the page they just edited turn into "Channel not found". That
 * substitutes a new *value* for a dead one; it never switches *form*.
 *
 * The corollary: renaming a Channel's slug (`ChannelSettingsForm`) does not
 * strand a link minted from the *id* form, and does not strand the renaming
 * operator's own tab, but it does strand every link already shared under the
 * old *slug* — those URLs simply stop resolving (the same "Channel not found"
 * a deleted Channel shows), since the slug lookup finds nothing under the old
 * value and nothing here keeps a history of retired slugs. See the warning at
 * the slug field itself for the operator-facing statement of that consequence.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a Channel id (UUID); false for a slug, including a malformed one. */
export function isChannelId(routeSegment: string): boolean {
  return UUID_PATTERN.test(routeSegment);
}
