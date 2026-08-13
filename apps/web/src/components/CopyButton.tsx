import { useEffect, useRef, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copy-to-clipboard action with visible confirmation (issue #47): the ingest
 * URL and a freshly minted token are both strings an operator pastes
 * elsewhere, and a copy that might silently have failed is worse than no copy
 * button at all — so the outcome is stated on the label rather than left to
 * the OS clipboard toast (invisible in a screenshot, absent entirely in some
 * browsers/sandboxes).
 *
 * A failed copy is stated too, not swallowed: `navigator.clipboard` is
 * undefined outside a secure context and can reject on a permission denial,
 * and a button that appears to do nothing at all on click leaves the operator
 * unable to tell whether the string reached the clipboard — "failure is
 * information" (`PRODUCT.md`).
 *
 * The glyph changes with the outcome as well as the label, so the confirmation
 * is legible in the same glance that the click ended in.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function handleCopy(): Promise<void> {
    let outcome: CopyState;
    try {
      await navigator.clipboard.writeText(value);
      outcome = "copied";
    } catch {
      outcome = "failed";
    }
    setState(outcome);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setState("idle"), 2000);
  }

  const stateLabel = { idle: label, copied: "Copied", failed: "Copy failed" }[state];
  const Glyph = { idle: Copy, copied: Check, failed: TriangleAlert }[state];

  return (
    <button type="button" className="control" onClick={() => void handleCopy()}>
      <Glyph size={13} strokeWidth={1.75} aria-hidden="true" />
      {stateLabel}
    </button>
  );
}
