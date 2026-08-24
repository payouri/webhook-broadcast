# Tailwind is not adopted in `apps/web` at current scale

`apps/web` styles itself with one hand-written stylesheet, `apps/web/src/styles.css`, whose custom
properties are the tokens declared in `DESIGN.md`'s frontmatter and whose rules implement that
document. No utility-CSS framework is added. Unlike `ADR 0013`, this is a judgment about scale rather than a
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
is `minmax(var(--status-lamp-column), auto)`. It spends twelve more deriving the status badge's
tone-and-form vocabulary from PRODUCT.md's "status is never encoded in color alone". It explains why
the focus-ring and control blocks are keyed on classes rather than on the bare `button` element:
`.button-ghost` and `.link-button` also land on router `Link`s, which render as `a` and never match
`button`. Each of
those comments sits at the point of enforcement, where the next person to touch the rule will
actually read it. Move the rules into `grid-cols-[minmax(116px,auto)_auto_1fr_auto_auto]` and that
reasoning has no home, so within a year someone "simplifies" the selector list and quietly breaks
focus rings on two components.

The class vocabulary is what is load-bearing, and it is deliberately not element selectors. The
bare `button` rule is a *reset* — it strips the UA appearance and carries none of its own — because
the previous element-selector system "broke both ways" (`<Link className="button-ghost">` got no
radius or padding, and `.channel-row` inherited the primary button's hover fill). Fields are keyed on
`.field-control` for the same reason; there is no bare `input` or `textarea` rule at all. So the 46
buttons and 10 inputs across the app are consistent because each opts into a named class, not because
an element selector caught them. Tailwind would have to absorb that whole vocabulary rather than just
the layout utilities — it cannot be left behind in an `@layer base` block the way a genuine
element-selector base layer could — which is what makes the migration all-or-nothing rather than
incremental.

## What argues for it, honestly

Over 120 hand-invented class names (`.activity-preview`, `.delivery-meta`, `.token-prefix`,
`.copy-row`) are real cost, and Tailwind removes naming from the job entirely. Dead styles become
self-eliminating, where today an orphaned rule sits in the stylesheet indefinitely with nothing to
flag it. And a component's appearance stops requiring a jump into a 2500-line file to reconstruct.

These are genuine, and the first and third have grown teeth since this was written. One stylesheet,
28 component files, a small team, and a written spec that predates the code. Tailwind's value scales with the number of people
fighting over a growing stylesheet, and that is not the situation.

Against that, the costs are concrete: Tailwind and its Vite plugin in the build; a `@theme` block
duplicating `DESIGN.md`'s token frontmatter and able to drift from it; roughly 130 class names ported
by hand across 28 files with every `DESIGN.md` rule re-verified visually, since no codemod does this;
and an escape hatch where `bg-[#fff]` and `text-[oklch(...)]` cost the same keystrokes as a token,
turning The Anodized Grey Rule and The One Voice Rule into lint problems rather than structural ones.
Today a named ground token such as `var(--face)` is the only path there is. The test suite is unaffected either way, as `apps/web/test`
queries by role and text rather than by class.

For reference, the scale this judgment is made at: `styles.css` is 2516 lines with 128 distinct
class selectors across 225 rule blocks, against 28 files and roughly 5300 lines of TSX in
`apps/web/src`.

## Status: reopen condition met, decision open

The first reopen condition below has fired. `styles.css` is 2516 lines — a thousand past the ~1500
threshold this ADR set — and the other scale figures have grown by roughly the same factor. By this
ADR's own terms that makes the decision **pending review, not settled**: nothing here should be read
as a standing rejection of Tailwind at the current size.

Whether to adopt it is a human call and is deliberately not made in this edit. The reasoning above
has been corrected against the code so that call is made on true premises; the second and third
conditions have not been checked and would need a look at specificity fights and at who is actually
editing the stylesheet. Until someone decides, the status quo holds by default — no utility framework
is added — but the argument for it should be re-read, not inherited.

## When to reopen this

Any one of these makes Tailwind the better answer, and none of them requires a new argument, only a
check:

- `styles.css` passes roughly 1500 lines. **Met** — 2516 lines as of this revision.
- Specificity fights start appearing, or rules accumulate that nobody can prove are still used.
- More than one or two people are editing the stylesheet concurrently and colliding.

At that point supersede this ADR. `ADR 0013` is unaffected by that change: kits stay out, and overlay
behavior still comes from headless `radix-ui` primitives, whatever the styling mechanism underneath.
