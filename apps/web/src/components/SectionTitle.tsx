import type { ReactNode } from "react";

/**
 * A section's engraved legend: a domain glyph, tracked caps, and a groove
 * running out to the full width. The groove is what replaced the panel border
 * around list regions — a scored line reads as a boundary without drawing a box
 * around content that is already delimited row by row.
 */
export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="section-title">
      <span className="section-title-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </h2>
  );
}
