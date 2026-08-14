/**
 * Row-to-row keyboard traversal (issue #53). The Activity and Delivery lists
 * are the busiest scanning surfaces in the product (PRODUCT.md's "scanning
 * beats reading"), but each row's toggle button sits beside an entire well of
 * nested controls once it is expanded — Attempts, a Retry button, a bulk-retry
 * confirm region. `Tab` still walks every one of those in document order, the
 * way it always has; this adds Up/Down/Home/End as an accelerator that only
 * ever lands on a row's own toggle button, never on anything nested beneath
 * it, by scoping the query to `[data-row-nav="true"]` — an attribute only the
 * row buttons themselves carry.
 *
 * A single delegated handler on the enclosing `<ul>` covers every row without
 * each row wiring its own listener or ref, and keeps working as rows are
 * added or removed (a poll refresh, "Load more") without any list of refs to
 * keep in sync.
 *
 * These lists nest: an expanded Broadcast's well holds the Delivery list, so a
 * keydown on a Delivery row reaches the Delivery `<ul>` and then the Activity
 * `<ul>` above it. Each list therefore traverses only the rows it owns —
 * `ownRows` drops any row that belongs to a nearer list — and stops the event
 * once it has moved focus, so one ArrowDown is one row rather than one per
 * enclosing list, and Home inside a Delivery list stays in that list instead of
 * jumping out to the first Broadcast.
 */
export function handleRowListKeyDown(event: React.KeyboardEvent<HTMLUListElement>): void {
  const { key } = event;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") {
    return;
  }

  const rows = ownRows(event.currentTarget);
  if (rows.length === 0) {
    return;
  }

  const currentIndex = rows.indexOf(document.activeElement as HTMLButtonElement);
  // Only intercept once focus is actually on one of this list's own row
  // buttons: otherwise these keys would hijack Home/End or Up/Down inside a
  // nested control in an expanded well (a future text field, a scroll region)
  // that has every right to its own meaning for them.
  if (currentIndex === -1) {
    return;
  }

  let nextIndex: number;
  if (key === "Home") {
    nextIndex = 0;
  } else if (key === "End") {
    nextIndex = rows.length - 1;
  } else if (key === "ArrowDown") {
    nextIndex = Math.min(currentIndex + 1, rows.length - 1);
  } else {
    nextIndex = Math.max(currentIndex - 1, 0);
  }

  event.preventDefault();
  event.stopPropagation();
  rows[nextIndex]?.focus();
}

/**
 * The row buttons this list owns, in document order: descendants marked for row
 * navigation whose nearest enclosing list is this one, so rows inside a nested
 * list (a Broadcast's Deliveries) belong to that list alone.
 */
function ownRows(list: HTMLUListElement): HTMLButtonElement[] {
  return Array.from(list.querySelectorAll<HTMLButtonElement>('[data-row-nav="true"]')).filter(
    (row) => row.closest("ul") === list,
  );
}
