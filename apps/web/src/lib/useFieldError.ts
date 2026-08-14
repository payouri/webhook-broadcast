import { useRef, useState, type RefObject } from "react";

export interface FieldErrorController<E extends HTMLElement> {
  /** The message to render this frame, or `null` when the field has nothing to say. */
  error: string | null;
  /** Attach to the field: gives submit-time focus somewhere to land. */
  ref: RefObject<E | null>;
  /** Attach to the field's `onBlur`. */
  onBlur: () => void;
  /** True once the field has been marked (blurred, or a submit attempt touched it). */
  touched: boolean;
  /** Marks the field without waiting for blur — what a submit attempt calls. */
  markTouched: () => void;
  /** Re-arms the field for a fresh entry (e.g. after a successful submit clears the form). */
  reset: () => void;
  /** The raw validation result, independent of `touched` — what submit-time gating reads. */
  isInvalid: () => boolean;
}

/**
 * Implements DESIGN.md §5's Reward-Early-Punish-Late Rule for a single field:
 * silent while first being filled in, marked on blur (Lamp Cut border, message
 * beneath, `aria-invalid`), and live on every keystroke once marked. `validate`
 * must read the contract's own schema and return its own message — never a
 * hand-restated copy of a constraint the schema already states (DESIGN.md
 * "Don't restate a contract constraint as a hand-written check").
 *
 * One call site per field; a form with several invalid fields calls
 * `markTouched` on each from its submit handler and uses `isInvalid`/`ref` to
 * focus the first of them, per the same rule's "moves focus to the first of
 * them".
 */
export function useFieldError<V, E extends HTMLElement = HTMLInputElement>(
  value: V,
  validate: (value: V) => string | null,
): FieldErrorController<E> {
  const [touched, setTouched] = useState(false);
  const ref = useRef<E>(null);

  return {
    error: touched ? validate(value) : null,
    ref,
    onBlur: () => setTouched(true),
    touched,
    markTouched: () => setTouched(true),
    reset: () => setTouched(false),
    isInvalid: () => validate(value) !== null,
  };
}
