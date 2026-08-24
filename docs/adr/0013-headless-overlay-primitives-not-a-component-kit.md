# Overlays take headless Radix primitives; `apps/web` adopts no pre-styled component kit

`apps/web` styles itself with hand-written CSS in `apps/web/src/styles.css`, driven by the tokens
and rules in `DESIGN.md` (whose frontmatter is the machine-readable half). `.impeccable/design.json`
is an earlier artifact and no longer the token source — where the two disagree, `DESIGN.md` and
`styles.css` win. It takes no component library, and it will
not take one. Every so often the question comes back as "should we migrate the front to shadcn/ui",
so this records the answer and the reasoning behind it.

`ADR 0004` names shadcn as part of throwaway prototype C, which is where the dashboard's IA came
from. The prototype's *information architecture* shipped; its styling stack did not, and that was
deliberate rather than an oversight.

## Why not a component kit

The surface a kit would replace is small. Twelve shared components under
`apps/web/src/components/` (`StatusLamp`, `CopyButton`, `InlineLoadError`, `NotFoundPanel`,
`ElapsedTime`, `EmptyState`, `PollStatusLine`, `SectionTitle`, `ShortcutsHelp`, `SkeletonRows`,
`Switch`, `ThemeToggle`) and three native controls: across the whole app, 46 `<button>`,
10 `<input>`, 2 `<textarea>`. There are no tables and no selects. There is exactly one floating
layer — `ElapsedTime`'s `role="tooltip"` exact-instant bubble — granted by `DESIGN.md` §4 Elevation
and dressed in this system's own classes, with no shadow token and no primitive behind it.

The value of shadcn is Radix underneath it, and Radix earns its keep on floating layers:
focus trapping, escape-to-dismiss, dismiss-on-outside-press, focus restoration, and the `aria-*`
wiring that makes those things legible to a screen reader. This app has one floating layer and it
needs none of that behavior — the exact-instant bubble is hover/focus-revealed prose with no focus to
trap and nothing to dismiss — and `DESIGN.md` §6 forbids adding the most common one: "Don't reach for a modal. Broadcast detail, Delivery detail, and
Endpoint editing are all inline expansions, and every future detail view should be too."

A kit's defaults also contradict this system almost line for line. shadcn ships `shadow-xs` on
button, `shadow-sm` on card, and `shadow-lg` on dialog and popover, against The No Drop Shadow Rule. Its
neutral scales (zinc, slate, stone) are untinted or blue-tinted, against The Anodized Grey Rule's
hue-195 requirement — which asks for exactly the cool tint those scales lack in a controlled amount
(chroma 0.002 to 0.011), not for warmth. The warm hue-75 neutrals survive only in
`.impeccable/design.json`, which is no longer the token source. Its `background`/`card` pair does not map onto the Plate → Face → Face Raised → Well →
Well Deep → Well Deepest nesting that carries depth here. Its badge variants (`default`/`secondary`/`destructive`/
`outline`) do not map onto the status vocabulary, where `tone` and `form` combine so that state
survives with color removed. Adopting a kit therefore means overriding it at every point where
`DESIGN.md` has an opinion, which is most of them, and a kit whose defaults are all overridden has
no remaining value to offer.

Enforcement gets weaker, too — though not because element selectors carry the rules. `styles.css`
decides the opposite explicitly: the bare `button` element carries no appearance of its own, and
geometry and color live on the classes (`.control`, `.commit`, `.row`, …), so a control looks
identical whether it renders as a `button`, an `a`, or a router `Link`. The stylesheet records that
the previous element-selector system "broke both ways" — `<Link className="button-ghost">` got no
radius or padding, and `.channel-row` inherited the primary button's fill on hover. Fields are keyed
on a `.field-control` class for the same reason; there is no bare `input` or `textarea` rule at all.

What a kit would weaken is that each rule is still stated *once*, in one place, for every call site
that opts into the class — `DESIGN.md` §5 states the focus treatment as "2px Anodize ring at 2px
offset, on every control, via `:focus-visible`", and `styles.css` enforces it in a single block. A
class-per-call-site utility approach re-asserts each rule at every use, and the components with no
kit counterpart (the Delivery row and the Channel row are `<button>` elements laid out with CSS grid)
fall outside the vocabulary entirely. The inline comments in `styles.css` also keep each rule's
rationale and its `DESIGN.md` citation at the point of enforcement, which class strings spread across
28 TSX files cannot do.

## What to do instead, and when

Reach for a primitive when a surface genuinely needs to float above content and inline expansion has
been tried and does not fit. Judge that on the interaction, not on convenience: a dropdown of
Channel filters, a command palette, an Endpoint-header tooltip. "It would be quicker as a modal" is
not the trigger.

When that happens, take the individual headless primitive from `radix-ui` and dress it in this
system's own classes. Take the behavior, not the skin. Add the one shadow token to `DESIGN.md` §4
before the call site uses it, per that section's existing instruction, and hold the overlay to the
terms of §4's overlay grant.

This scopes to `apps/web`'s runtime styling. It says nothing about tooling that renders throwaway
artifacts (prototypes under `prototypes/`, generated HTML reports), which are free to use whatever
is fastest because nobody maintains them.

It is also a decision about component *kits*, not about the styling *mechanism*. Whether the CSS is
hand-written or generated by a utility framework is `ADR 0014`'s question, and the answer there does
not disturb this one: kits stay out either way, and overlay behavior comes from headless primitives
regardless of what styles them.
