/**
 * Fails when a color token in DESIGN.md's frontmatter disagrees with the value
 * `apps/web/src/styles.css` actually ships, in either theme.
 *
 * DESIGN.md declares itself binding current-state, and its frontmatter is the
 * machine-readable half of §2 — so a frontmatter value the stylesheet has moved
 * past is a descriptive error, not a target. `--lamp-live` is the case that
 * motivated this: the doc published `52%` while the stylesheet had deliberately
 * darkened it to `48%` so the 11px/600 legend measures 5.9:1, meaning the
 * documented value failed the very reason the code moved.
 *
 * Light values are read from the bare `:root` block. Dark values are read from
 * the `--dark-*` sources in that same block, which the two dark selectors both
 * assign from — checking those selectors instead would compare `var(--dark-x)`
 * strings rather than colors.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN = resolve(repoRoot, "DESIGN.md");
const STYLES = resolve(repoRoot, "apps/web/src/styles.css");

/**
 * `colors:`/`colorsDark:` from the frontmatter. Deliberately a line scanner
 * rather than a YAML dependency: the block is a flat `key: "value"` map by
 * construction (every other frontmatter section is nested and is not read here).
 */
function readTokenMap(design: string, section: "colors" | "colorsDark"): Map<string, string> {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(design)?.[1];
  if (frontmatter === undefined) {
    throw new Error("DESIGN.md: no frontmatter block");
  }
  const map = new Map<string, string>();
  let inSection = false;
  for (const line of frontmatter.split("\n")) {
    if (/^[A-Za-z]/.test(line)) {
      inSection = line.trimEnd() === `${section}:`;
      continue;
    }
    if (!inSection) continue;
    const entry = /^\s{2}([a-z0-9-]+):\s*"(.+)"\s*$/.exec(line);
    if (entry?.[1] !== undefined && entry[2] !== undefined) {
      map.set(entry[1], entry[2]);
    }
  }
  if (map.size === 0) {
    throw new Error(`DESIGN.md: frontmatter section \`${section}:\` is empty or missing`);
  }
  return map;
}

/** Custom-property declarations in the bare `:root { … }` block. */
function readRootTokens(styles: string): Map<string, string> {
  const opening = styles.indexOf(":root {");
  if (opening === -1) {
    throw new Error("styles.css: no bare `:root {` block");
  }
  let depth = 0;
  let end = -1;
  for (let index = styles.indexOf("{", opening); index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    else if (styles[index] === "}" && --depth === 0) {
      end = index;
      break;
    }
  }
  if (end === -1) {
    throw new Error("styles.css: the `:root` block is never closed");
  }
  const body = styles.slice(opening, end);
  const map = new Map<string, string>();
  for (const match of body.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      map.set(name, value.trim());
    }
  }
  return map;
}

/**
 * `oklch(23% 0.010 195)` and `oklch(23% 0.01 195)` are the same color; a
 * trailing zero in the doc is not drift worth failing a build over.
 */
function normalize(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\d*\.\d*?)0+(?=\D|$)/g, "$1")
    .replace(/\.(?=\D|$)/g, "");
}

const design = readFileSync(DESIGN, "utf8");
const styles = readFileSync(STYLES, "utf8");
const root = readRootTokens(styles);

const problems: string[] = [];
let checked = 0;

for (const [section, prefix] of [
  ["colors", ""],
  ["colorsDark", "dark-"],
] as const) {
  for (const [token, documented] of readTokenMap(design, section)) {
    const property = `${prefix}${token}`;
    const shipped = root.get(property);
    if (shipped === undefined) {
      problems.push(
        `${section}.${token}: DESIGN.md documents it, but styles.css declares no \`--${property}\` in \`:root\``,
      );
      continue;
    }
    checked += 1;
    if (normalize(shipped) !== normalize(documented)) {
      problems.push(
        `${section}.${token}: DESIGN.md says \`${documented}\`, styles.css ships \`${shipped}\` (--${property})`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(
    `DESIGN.md token drift (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    "\nDESIGN.md is binding current-state: correct the frontmatter to what ships, or change the stylesheet and the prose together.",
  );
  process.exit(1);
}

console.log(`DESIGN.md tokens match styles.css: ${checked} values across both themes.`);
