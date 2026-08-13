/**
 * Loading previews the shape of the rows that are coming, rather than parking a
 * centered "Loading…" where content is about to be: the operator's routine check
 * is a glance, and a skeleton keeps the glance aimed at the right part of the
 * screen. It pulses on opacity only, so nothing about the layout moves when the
 * real rows land.
 */
export function SkeletonRows({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}
