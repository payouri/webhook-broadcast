import { useState } from "react";
import { ChevronDown, ChevronRight, Keyboard } from "lucide-react";

export interface ShortcutEntry {
  keys: string;
  description: string;
}

/**
 * Discoverable keyboard accelerators (issue #53). PRODUCT.md's operator reads
 * HTTP fluently but has no reason to already know this dashboard's own key
 * bindings, and the issue that introduced them is not part of the interface —
 * so this renders next to the list they act on, as inline disclosure (DESIGN.md
 * ss4: no overlays), never only as a comment or a PR description.
 *
 * A native `<details>` rather than a hand-rolled toggle: it is keyboard-operable
 * and exposes its own open/closed state to assistive tech for free, and this
 * surface's whole point is not depending on the operator already knowing an
 * interaction to find out about other interactions.
 *
 * Issue #79: opening this used to move its own trigger — the caller renders it
 * as the last thing in the list section (never beside a filter toggle in a
 * `justify-content: space-between` row) so the growing `<ul>` below the summary
 * only ever extends into empty space beneath it, and never changes the width or
 * position of anything else on screen. `open` is lifted into state (rather than
 * left as the browser's own uncontrolled toggle) purely so the chevron can
 * state which way it is at rest — the same `[open]` shape the row families
 * already use for "whether this opens, and whether it is open now" — instead of
 * that fact only being discoverable by pressing the control.
 */
export function ShortcutsHelp({ items }: { items: readonly ShortcutEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="shortcuts-help"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {/* `.control` alone: this is a disclosure, not a filter, and every
          `.control-filter` rule keys off `aria-pressed`, which a `<summary>`
          does not carry — `[open]` states this one's position instead. */}
      <summary className="control">
        <Keyboard size={13} strokeWidth={1.75} aria-hidden="true" />
        Keyboard shortcuts
        <span className="muted shortcuts-help-chevron">
          {open ? (
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
      </summary>
      <ul className="shortcuts-help-list">
        {items.map((item) => (
          <li key={item.keys}>
            <kbd>{item.keys}</kbd>
            <span>{item.description}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
