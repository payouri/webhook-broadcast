# Tailwind is not adopted in `apps/web` at current scale

`apps/web` styles itself with one hand-written stylesheet, `apps/web/src/styles.css`, whose custom
properties are the tokens in `.impeccable/design.json` and whose rules implement `DESIGN.md`. No
utility-CSS framework is added. Unlike `ADR 0013`, this is a judgment about scale rather than a
principle, and it carries an explicit condition for reopening.

Keep the two separate. `ADR 0013` rejects pre-styled component kits because their defaults contradict
`DESIGN.md` at nearly every point, which is a conflict that does not go away with effort. Tailwind is
a styling mechanism, not a design system: its `@theme` block holds this system's OKLCH tokens
natively, and it imports no shadows, no untinted grey scale, and no status variants. None of 0013's
argument transfers. Tailwind is a reasonable thing to want here. It is simply not worth its migration
at the size this app currently is.

## What argues against it here

The stylesheet's comments are the design system's working memory, and a class string has nowhere to
put them. `styles.css` spends ten lines on the Channel row's `grid-template-columns` explaining that
each row is its own grid, so an `auto` leading track sizes to that row's own label and would place
the slug at a different x on an `ENABLED` row than on an `AUTO-DISABLED` one, which is why the track
is `minmax(var(--status-stamp-column), auto)`. It spends twelve more deriving the status badge's
tone-and-form vocabulary from PRODUCT.md's "status is never encoded in color alone". It explains why
the focus-ring block needs class selectors alongside the bare `button` selector: `.button-ghost` and
`.link-button` also land on router `Link`s, which render as `a` and never match `button`. Each of
those comments sits at the point of enforcement, where the next person to touch the rule will
actually read it. Move the rules into `grid-cols-[minmax(116px,auto)_auto_1fr_auto_auto]` and that
reasoning has no home, so within a year someone "simplifies" the selector list and quietly breaks
focus rings on two components.

The element selectors are also load-bearing. Bare `button`, `input`, and `textarea` rules make a
newly added control correct by default, which is why 23 buttons and 10 inputs across the app are
consistent without any per-call-site discipline. Tailwind has no element selectors, so those rules
would stay in an `@layer base` block exactly as written, which is what Tailwind's own guidance
advises for base styles. That leaves the load-bearing half of the stylesheet in place and lets
Tailwind absorb only the layout utilities: the same migration cost for a smaller share of the
benefit.

## What argues for it, honestly

Nearly 60 hand-invented class names (`.activity-preview`, `.delivery-meta`, `.token-prefix`,
`.copy-row`) are real cost, and Tailwind removes naming from the job entirely. Dead styles become
self-eliminating, where today an orphaned rule sits in the stylesheet indefinitely with nothing to
flag it. And a component's appearance stops requiring a jump into a 660-line file to reconstruct.

These are genuine, and none of them is currently painful. One stylesheet, 20 component files, a small
team, and a written spec that predates the code. Tailwind's value scales with the number of people
fighting over a growing stylesheet, and that is not the situation.

Against that, the costs are concrete: Tailwind and its Vite plugin in the build; a `@theme` block
duplicating `.impeccable/design.json` and able to drift from it, which matters because the
`impeccable` skill reads that file as the source of truth; roughly 50 class names ported by hand
across 20 files with every `DESIGN.md` rule re-verified visually, since no codemod does this; and an
escape hatch where `bg-[#fff]` and `text-[oklch(...)]` cost the same keystrokes as a token, turning
The Warm Grey Rule and The One Voice Rule into lint problems rather than structural ones. Today
`var(--paper)` is the only path there is. The test suite is unaffected either way, as `apps/web/test`
queries by role and text rather than by class.

For reference, the scale this judgment is made at: `styles.css` is 660 lines with 58 distinct class
selectors, against 20 files and roughly 1400 lines of TSX in `apps/web/src`.

## When to reopen this

Any one of these makes Tailwind the better answer, and none of them requires a new argument, only a
check:

- `styles.css` passes roughly 1500 lines.
- Specificity fights start appearing, or rules accumulate that nobody can prove are still used.
- More than one or two people are editing the stylesheet concurrently and colliding.

At that point supersede this ADR. `ADR 0013` is unaffected by that change: kits stay out, and overlay
behavior still comes from headless `radix-ui` primitives, whatever the styling mechanism underneath.
