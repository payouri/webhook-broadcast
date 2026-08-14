import { Keyboard } from "lucide-react";

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
 */
export function ShortcutsHelp({ items }: { items: readonly ShortcutEntry[] }) {
  return (
    <details className="shortcuts-help">
      {/* `.control` alone: this is a disclosure, not a filter, and every
          `.control-filter` rule keys off `aria-pressed`, which a `<summary>`
          does not carry — `[open]` states this one's position instead. */}
      <summary className="control">
        <Keyboard size={13} strokeWidth={1.75} aria-hidden="true" />
        Keyboard shortcuts
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
