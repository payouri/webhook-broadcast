/**
 * A switch plate: the faceplate form of a boolean.
 *
 * The native checkbox was the one element on this surface drawn entirely by the
 * platform — a saturated blue square belonging to no palette here, carrying
 * none of the system's form language, and reading as the Bootstrap-era default
 * it is. This draws over it instead of replacing it: the real `input` stays in
 * the tree, stays the thing the `label` points at, and stays what the keyboard
 * toggles, so `Space`, `:checked`, `:disabled`, and form semantics are the
 * browser's own rather than reimplemented.
 *
 * State is carried by the plunger's *position* as well as by the well's color,
 * so which way the switch is thrown survives color being removed.
 */
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        className="switch-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-plate" aria-hidden="true">
        <span className="switch-plunger" />
      </span>
      {label}
    </label>
  );
}
