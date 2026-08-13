# Overlays take headless Radix primitives; `apps/web` adopts no pre-styled component kit

`apps/web` styles itself with hand-written CSS in `apps/web/src/styles.css`, driven by the tokens in
`.impeccable/design.json` and the rules in `DESIGN.md`. It takes no component library, and it will
not take one. Every so often the question comes back as "should we migrate the front to shadcn/ui",
so this records the answer and the reasoning behind it.

`ADR 0004` names shadcn as part of throwaway prototype C, which is where the dashboard's IA came
from. The prototype's *information architecture* shipped; its styling stack did not, and that was
deliberate rather than an oversight.

## Why not a component kit

The surface a kit would replace is small. Four shared components (`StatusBadge`, `CopyButton`,
`InlineLoadError`, `NotFoundPanel`) and three native controls: across the whole app, 23 `<button>`,
10 `<input>`, 2 `<textarea>`. There are no tables, no selects, and no floating layers of any kind.

The value of shadcn is Radix underneath it, and Radix earns its keep on floating layers:
focus trapping, escape-to-dismiss, dismiss-on-outside-press, focus restoration, and the `aria-*`
wiring that makes those things legible to a screen reader. This app has none, and `DESIGN.md` §6
forbids adding the most common one: "Don't reach for a modal. Broadcast detail, Delivery detail, and
Endpoint editing are all inline expansions, and every future detail view should be too."

A kit's defaults also contradict this system almost line for line. shadcn ships `shadow-xs` on
button, `shadow-sm` on card, and `shadow-lg` on dialog and popover, against The No Shadow Rule. Its
neutral scales (zinc, slate, stone) are untinted or blue-tinted, against The Warm Grey Rule's hue-75
requirement. Its `background`/`card` pair does not map onto the Paper → Surface → Surface Sunk
three-step that carries depth here. Its badge variants (`default`/`secondary`/`destructive`/
`outline`) do not map onto the status vocabulary, where `tone` and `form` combine so that state
survives with color removed. Adopting a kit therefore means overriding it at every point where
`DESIGN.md` has an opinion, which is most of them, and a kit whose defaults are all overridden has
no remaining value to offer.

Enforcement gets weaker, too. `styles.css` states most rules once, on element selectors: `button`,
`input`, and `textarea` are correct by default, and the focus-ring block states "2px Patch Plum ring
at 2px offset, on every button without exception" in a single place. A class-per-call-site approach
re-asserts each rule at every use, and the components with no kit counterpart (the Delivery Row and
the Channel row are `<button>` elements laid out with CSS grid) fall outside the vocabulary
entirely. The inline comments in `styles.css` also keep each rule's rationale and its `DESIGN.md`
citation at the point of enforcement, which class strings spread across 20 TSX files cannot do.

## What to do instead, and when

Reach for a primitive when a surface genuinely needs to float above content and inline expansion has
been tried and does not fit. Judge that on the interaction, not on convenience: a dropdown of
Channel filters, a command palette, an Endpoint-header tooltip. "It would be quicker as a modal" is
not the trigger.

When that happens, take the individual headless primitive from `radix-ui` and dress it in this
system's own classes. Take the behavior, not the skin. Add the one shadow token to `DESIGN.md` §4
before the call site uses it, per that section's existing instruction, and hold the overlay to the
terms in §5 Overlays.

This scopes to `apps/web`'s runtime styling. It says nothing about tooling that renders throwaway
artifacts (prototypes under `prototypes/`, generated HTML reports), which are free to use whatever
is fastest because nobody maintains them.
