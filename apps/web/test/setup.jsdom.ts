import { configure } from "@testing-library/react";

/**
 * Testing Library's async utilities (`findBy*`, `waitFor`) default to a 1000ms
 * budget of their own, independent of Vitest's `testTimeout` (issue #105).
 * That 1s is what actually expired when the suite went red for reasons
 * unrelated to the diff: a `findBy*` gave up against a still-rendering
 * `skeleton-row` while a testcontainers Postgres startup elsewhere in the run
 * held the CPU. Raising Vitest's timeout alone changed nothing, because Vitest
 * was never the clock that ran out.
 *
 * 5000ms is chosen to sit strictly below this project's `testTimeout`, so a
 * wait that never resolves still fails as a Testing Library error naming the
 * element it could not find, rather than as an opaque Vitest timeout.
 */
configure({ asyncUtilTimeout: 5000 });
