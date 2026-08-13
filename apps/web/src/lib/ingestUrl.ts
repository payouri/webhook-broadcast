/**
 * The public `POST /ingest/:slug` URL a producer posts to (issue #47). It is
 * the single most important string in this product, and until now it lived
 * nowhere in the dashboard — only in the README and, transiently, in the
 * Activity tab's empty state.
 *
 * Derived from the browser's own origin rather than a configured constant:
 * both nginx (production, `apps/web/nginx.conf`) and the Vite dev proxy
 * (`apps/web/vite.config.ts`) forward `/ingest` same-origin alongside the
 * rest of the admin API, so the dashboard's origin is always the ingest
 * origin too.
 */
export function ingestUrl(slug: string): string {
  // Encoded because the Settings slug field is free text: a slug still being
  // typed can hold characters the contract's kebab-case rule will reject, and
  // the URL shown should stay a valid URL rather than an unpastable one. A
  // valid slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) passes through unchanged.
  return `${window.location.origin}/ingest/${encodeURIComponent(slug)}`;
}
