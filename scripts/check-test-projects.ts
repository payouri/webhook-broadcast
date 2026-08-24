/**
 * Fails when a test file is collected by no Vitest project, or by more than one.
 *
 * `vitest.config.ts` splits the suite into three projects across two ordered
 * groups (issue #105), which replaced a single global `include` that could not
 * miss a file. Three hand-written include lists can: a new file under a path no
 * list matches is silently never run, and CI stays green while the test does
 * nothing. The opposite failure is just as quiet — while splitting the config,
 * an `exclude` that replaced Vitest's defaults instead of extending them
 * collected the contract package's tests a second time through the pnpm
 * workspace symlink under `packages/db/node_modules`, and the only visible
 * symptom was the file count rising from 50 to 53.
 *
 * The filesystem is the source of truth for what a test file is; `vitest list`
 * is the source of truth for what the config actually collects. Anything the
 * first has and the second does not — or the second has twice — is drift.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Every `*.test.ts`/`*.test.tsx` under a `test/` directory, the repo's convention. */
function findTestFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        findTestFiles(full, found);
      }
    } else if (/\.test\.tsx?$/.test(entry.name) && relative(repoRoot, full).includes("/test/")) {
      found.push(relative(repoRoot, full));
    }
  }
  return found;
}

/** `vitest list --filesOnly` prints one `[project] path` line per collected file. */
function listCollectedFiles(): { project: string; file: string }[] {
  const stdout = execFileSync("npx", ["vitest", "list", "--filesOnly"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const collected: { project: string; file: string }[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\[([^\]]+)\]\s+(\S+)$/.exec(line.trim());
    if (match) {
      collected.push({ project: match[1], file: match[2] });
    }
  }
  return collected;
}

const onDisk = ROOTS.flatMap((root) => findTestFiles(resolve(repoRoot, root))).sort();
const collected = listCollectedFiles();

const problems: string[] = [];

const collectedBy = new Map<string, string[]>();
for (const { project, file } of collected) {
  collectedBy.set(file, [...(collectedBy.get(file) ?? []), project]);
}

for (const file of onDisk) {
  const projects = collectedBy.get(file);
  if (!projects) {
    problems.push(`${file} is a test file that no Vitest project collects — it never runs`);
  }
}

for (const [file, projects] of collectedBy) {
  if (projects.length > 1) {
    problems.push(`${file} is collected by ${projects.length} projects (${projects.join(", ")})`);
  }
  if (!onDisk.includes(file)) {
    problems.push(`${file} is collected but is not a test file under a test/ directory`);
  }
}

if (problems.length > 0) {
  console.error(
    `Vitest project coverage drift (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
  );
  for (const problem of problems.sort()) {
    console.error(`  - ${problem}`);
  }
  console.error(
    "\nEvery test file must match exactly one project's include in vitest.config.ts. When adding an exclude, spread configDefaults.exclude rather than replacing it.",
  );
  process.exit(1);
}

console.log(
  `Vitest projects cover every test file: ${onDisk.length} files, each collected exactly once.`,
);
