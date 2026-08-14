---
name: webhook-broadcast
description: Operator console for a single-tenant webhook multiplexer, built as a machined faceplate rather than a rounded-rectangle admin template.
colors:
  plate: "oklch(96.6% 0.004 195)"
  face: "oklch(99.2% 0.002 195)"
  well: "oklch(94% 0.006 195)"
  score: "oklch(88% 0.007 195)"
  score-strong: "oklch(79% 0.009 195)"
  score-control: "oklch(61% 0.011 195)"
  ink: "oklch(23% 0.010 195)"
  ink-muted: "oklch(50% 0.010 195)"
  anodize: "oklch(48% 0.115 195)"
  anodize-pressed: "oklch(40% 0.105 195)"
  anodize-wash: "oklch(93% 0.028 195)"
  anodize-ink: "oklch(99% 0.004 195)"
  lamp-live: "oklch(52% 0.14 152)"
  lamp-live-glass: "oklch(93% 0.045 152)"
  lamp-cut: "oklch(51% 0.19 27)"
  lamp-cut-glass: "oklch(93% 0.05 27)"
colorsDark:
  plate: "oklch(20% 0.008 195)"
  face: "oklch(24.5% 0.008 195)"
  well: "oklch(16.5% 0.008 195)"
  score: "oklch(31% 0.010 195)"
  score-strong: "oklch(41% 0.011 195)"
  score-control: "oklch(54% 0.011 195)"
  ink: "oklch(93% 0.004 195)"
  ink-muted: "oklch(67% 0.008 195)"
  anodize: "oklch(68% 0.105 195)"
  anodize-pressed: "oklch(58% 0.1 195)"
  anodize-wash: "oklch(29% 0.035 195)"
  anodize-ink: "oklch(17% 0.02 195)"
  lamp-live: "oklch(72% 0.14 152)"
  lamp-live-glass: "oklch(28% 0.05 152)"
  lamp-cut: "oklch(70% 0.16 27)"
  lamp-cut-glass: "oklch(28% 0.06 27)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  engraved:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.07em"
    textTransform: "uppercase"
rounded:
  control: "2px"
  plate: "3px"
  lamp: "50%"
spacing:
  2xs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  control:
    backgroundColor: "{colors.face}"
    textColor: "{colors.ink}"
    borderColor: "{colors.score-control}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    boxShadow: "inset 0 1px 0 {lip.light}, 0 1px 0 {lip.shade}"
  control-hover:
    backgroundColor: "{colors.well}"
    borderColor: "{colors.ink-muted}"
  control-active:
    backgroundColor: "{colors.well}"
    boxShadow: "inset 0 2px 3px {lip.shade-deep}"
  control-primary:
    backgroundColor: "{colors.anodize}"
    borderColor: "{colors.anodize}"
    textColor: "{colors.anodize-ink}"
    fontWeight: 600
  control-commit:
    backgroundColor: "{colors.face}"
    textColor: "{colors.anodize}"
    borderColor: "{colors.anodize}"
    fontWeight: 600
  field:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    borderColor: "{colors.score-control}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    boxShadow: "inset 0 1px 2px {lip.shade}"
  switch-plate:
    backgroundColor: "{colors.well}"
    borderColor: "{colors.score-control}"
    rounded: "{rounded.control}"
    size: "34px 20px"
  switch-plate-checked:
    backgroundColor: "{colors.anodize}"
    borderColor: "{colors.anodize}"
  plate:
    backgroundColor: "{colors.face}"
    borderColor: "{colors.score}"
    rounded: "{rounded.plate}"
    padding: "20px"
    boxShadow: "inset 0 1px 0 {lip.light}"
  well:
    backgroundColor: "{colors.well}"
    borderColor: "{colors.score}"
    rounded: "{rounded.plate}"
    padding: "12px"
    boxShadow: "inset 0 1px 2px {lip.shade}"
  row:
    backgroundColor: "{colors.face}"
    textColor: "{colors.ink}"
    borderColor: "{colors.score}"
    typography: "{typography.body}"
    rounded: "{rounded.plate}"
    padding: "10px 12px"
  row-hover:
    backgroundColor: "{colors.well}"
    borderColor: "{colors.score-strong}"
  row-selected:
    backgroundColor: "{colors.anodize-wash}"
    borderColor: "{colors.anodize}"
  tab:
    textColor: "{colors.ink-muted}"
    typography: "{typography.engraved}"
    padding: "10px 2px"
  tab-active:
    textColor: "{colors.anodize}"
    borderBottom: "2px solid {colors.anodize}"
  lamp-live:
    glassFill: "{colors.lamp-live-glass}"
    glassEdge: "{colors.lamp-live}"
    textColor: "{colors.lamp-live}"
    typography: "{typography.engraved}"
  lamp-cut:
    glassFill: "{colors.lamp-cut-glass}"
    glassEdge: "{colors.lamp-cut}"
    textColor: "{colors.lamp-cut}"
    typography: "{typography.engraved}"
  lamp-neutral:
    glassFill: "{colors.well}"
    glassEdge: "{colors.score-control}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.engraved}"
  lamp-hollow:
    glassFill: "transparent"
    glassEdge: "{colors.score-control}"
---

# Design System: webhook-broadcast

> `.impeccable/design.json` is a generated snapshot of the previous system ("The
> Switchboard") and is stale. This document is binding; regenerate the JSON with
> `/impeccable document` when convenient.

## 1. Overview

**Creative North Star: "The Faceplate"**

A switchboard was the right metaphor for what this product does: one incoming line patched out to
many. It was drawn wrong. The previous system rendered it flat, in warm paper tones, with 8px
rounded rectangles for every button, panel, row, and badge, which is the exact vocabulary of a
Bootstrap admin template: one filled accent rect, one bordered ghost rect, pill badges, uniform grey
boxes. Density without a form language is what that produces.

This system takes the metaphor literally instead. The interface is a **machined faceplate**: a plate
of anodized aluminium with controls milled into it. Corners are 2px, not 8px, because equipment has
milled edges and not soft ones. Depth is mechanical rather than atmospheric: a control is _raised_
(a highlight inside its top edge, a hairline of shade under its bottom) and _presses_ (the lip
inverts, the plate sinks). A field is the inverse, a **well** cut into the plate, with the shade
falling inward. A status is a **lamp**: a round glass in a bezel, lit or unlit, with a glyph inside
it and a tracked-caps legend stamped beside it.

The neutrals are graphite at hue 195, tinted toward the accent the way a plate is tinted by its own
anodizing. The accent is that same hue at twenty times the chroma: **Anodized Cyan**, carrying every
operator action and every current selection. Green and red appear only as lamp states, never as the
accent and never as decoration, so "healthy" can never be confused with "selected".

**Scene**: two or three engineers at their desks in a normally lit office, mid-morning, this console
in a tab between a dark editor and a dark terminal, glancing at it every few minutes rather than
staring at it. That forces a light default. A dark theme ships alongside it for editor parity, which
is a real reason and not the observability-dashboard reflex; both are first-class and every token is
defined twice.

It rejects the two things PRODUCT.md named: **enterprise monitoring dread** (walls of red gauges,
undifferentiated dense config panels, density with no ranking) and **consumer SaaS marketing bleed**
(gradients, illustrations, mascots, hero-metric tiles). Density is a goal here. Density without
hierarchy is the failure.

**Key Characteristics:**

- Machined form language: 2px controls, 3px plates, no pills except a lamp's round glass
- Mechanical depth: inner highlight and inner shade describe raised and pressed; no drop shadows
- Restrained color: one accent under 10% of any screen, lamp colors quarantined to state
- Light default and a real dark theme, every token defined for both
- Row-first layout, with a constant leading lamp column so state reads down the column
- Every state carried four ways: glyph, form, label, color
- One icon family (`lucide-react`), one stroke weight, never mixed with another set

## 2. Colors

Graphite neutrals and one anodized accent, with two lamp colors held in reserve for state.

### Primary

- **Anodize** (`oklch(48% 0.115 195)` light, `oklch(68% 0.105 195)` dark): the operator's own voice.
  Primary controls (Save changes, Mint new token, Retry), the active tab, the active filter, focus
  rings, and the selected-row wash. It marks what the operator is doing or has selected. It never
  marks what the system is reporting.
- **Anodize Pressed**: hovered and pressed states of primary controls, and the hover of an outlined
  commit control.
- **Anodize Wash**: the tinted ground of a selected or expanded row, and of the active filter.
- **Anodize Ink**: text on an anodized ground. Near-white in the light theme, near-black in the dark
  one, because the accent lifts above mid-lightness there.

The accent hue sits deliberately off the red-green axis. Roughly 8% of men have a red-green color
vision deficiency, and an accent on that axis would collide with the lamps for exactly the readers
who most need the two kinds of meaning kept apart.

### Secondary

Deliberately absent. Restrained means one accent. A second would compete with the lamps for meaning,
and meaning is the scarce resource on this surface.

### Tertiary

- **Lamp Live** (`oklch(52% 0.14 152)`) on **Lamp Live Glass**: a Delivery that succeeded, an
  Endpoint or Channel that is enabled, a Channel with no recent failures.
- **Lamp Cut** (`oklch(51% 0.19 27)`) on **Lamp Cut Glass**: a Delivery that failed or
  dead-lettered, an auto-disabled Endpoint, a failing Channel, a form validation error, an Attempt
  that errored.

These two are the only saturated colors permitted outside the accent. They are a vocabulary, not a
palette: they attach to state and nothing else.

### Neutral

- **Plate** (`oklch(96.6% 0.004 195)`): the page ground.
- **Face** (`oklch(99.2% 0.002 195)`): raised content. Faceplates, the header, rows, controls. It is
  the lightest value in the light theme and it is still not white.
- **Well** (`oklch(94% 0.006 195)`): recessed content. Fields, payload blocks, expanded detail,
  hovered rows, empty states. Always darker than Face, in **both** themes.
- **Score** (`oklch(88% 0.007 195)`): every default border and divider, always 1px. This is what the
  grooves are drawn in — the section legend's rule, the divider under the tab strip. Measures
  `1.40:1` against Face in the light theme and `1.24:1` in the dark one; it is a pure divider and
  carries no non-text-contrast obligation.
- **Score Strong** (`oklch(79% 0.009 195)` light, `oklch(41% 0.011 195)` dark): the heavier border
  that is still not a component's edge — a hovered row, a payload block, an empty state's dashed
  well. These need to survive against Well rather than state an affordance, so this token is not held
  to the `3:1` non-text-contrast target.
- **Score Control** (`oklch(61% 0.011 195)` light, `oklch(54% 0.011 195)` dark): the resting boundary
  of every control, field, switch plate, and lamp bezel. See "The Component Boundary Contrast
  Decision" below for the ratios it was designed against.
- **Ink** / **Ink Muted**: primary text; metadata, engraved legends, and placeholders.

### The lip

Not colors so much as light. A raised surface takes a highlight inside its top edge (**Lip Light**)
and casts a hairline beneath it (**Lip Shade**); a pressed or recessed one takes **Lip Shade Deep**
on the inside. In the dark theme these invert in prominence: the highlight nearly vanishes and the
recess is what you read. All three are zero-blur or near-zero-blur. They describe an edge, never a
float.

### Named Rules

**The One Voice Rule.** Anodize covers no more than 10% of any screen and only ever means "the
operator did this or chose this". If an element reports system state, it may not be anodized.

**The Quarantine Rule.** Lamp Live and Lamp Cut attach to Delivery status, Attempt outcome, enabled
state, and failure text. They are forbidden on controls, links, headings, borders of non-status
elements, and anything decorative. A red border on a plate is a violation; a red `DEAD LETTERED`
lamp is correct.

**The Anodized Grey Rule.** Every neutral carries hue 195 at chroma 0.002 to 0.011. There is no
`#fff`, no `#000`, and no untinted grey anywhere in this system. If a grey looks warm, it is wrong.

**The Both-Themes Rule.** A color introduced in one theme is not introduced until it exists in the
other. Dark is not an inversion: grounds compress, the accent lifts, the lamps lift, and the lip
flips.

### The Component Boundary Contrast Decision

`PRODUCT.md` records that WCAG 2.2 AA was considered and deliberately not adopted as a requirement,
to be followed "where it costs nothing." Component-boundary contrast cost something visible — a
step from `79%`/`41%` lightness to `61%`/`54%` reads as a harder-edged plate — so the decision below
was made deliberately rather than by checklist.

Before the split, `Score Strong` did two jobs at once: the resting border of every control, field,
switch plate, and lamp bezel, _and_ the heavier non-component border on a hovered row, a payload
block, and an empty state. Measured against the two grounds a control can sit on:

| Pair                   | Light    | Dark     |
| ---------------------- | -------- | -------- |
| `Score Strong` on Face | `1.88:1` | `1.84:1` |
| `Score Strong` on Well | `1.62:1` | `2.19:1` |

Both fall short of WCAG 2.2 §1.4.11's `3:1` for a UI component's boundary, and DESIGN.md §5's own
claim — "every control states its affordance at rest… a border that only appears on hover is a
defect" — was not true of a border this close to invisible in normal office light.

The chosen fix: split the token. `Score Strong` keeps its exact value and its three non-component
call sites — the hovered row's border, `.payload`, `.empty-state`. A new token, `Score Control`,
takes over the resting boundary of `.control`, `input`/`textarea`, `.switch-plate`,
`.switch-plunger`, and every lamp bezel — the surfaces `§1.4.11` actually covers. It was designed to
clear `3:1` against **both** Face and Well, not just the nearer one:

| Pair                    | Light (`61%`) | Dark (`54%`) |
| ----------------------- | ------------- | ------------ |
| `Score Control` on Face | `3.69:1`      | `3.22:1`     |
| `Score Control` on Well | `3.17:1`      | `3.82:1`     |

`61%` was taken rather than the `62%` the audit suggested: at `62%` the Well pair lands on `3.05:1`,
close enough to the line that a later tweak to Well would break it, and `61%` buys margin without
reading as a harder edge.

No groove or divider got darker, because the grooves are drawn in `Score`, not `Score Strong` —
`.section-title::after` and the `.tabs` bottom border both take `Score`, and it was left untouched.
The lit and hollow lamp forms stay distinguishable at the new value because the distinction is
carried by fill (`Well`-toned vs. transparent), not by the edge color, and both lamp forms share the
same edge.

## 3. Typography

**Display Font:** none. This system has no display face and does not want one.
**Body Font:** system UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
Arial, sans-serif`)
**Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

**Character:** one native sans doing every job. Hierarchy is carried by weight as much as by size,
which is what keeps a dense operator surface ranked without the sizes drifting far apart. The
monospace face is the second voice and it is strictly semantic: it means "this string came from a
machine and its exact characters matter". A URL, a payload body, an outbound header, a token prefix,
an ingest path, and a body preview are monospace. A Channel slug, a timestamp, a duration, and a
status code are not; they are read, not copied.

### Hierarchy

- **Headline** (650, 1.4375rem, 1.2, -0.015em): the Channel slug on Channel detail, the not-found
  title, the login lockup. One per screen.
- **Title** (600, 1rem, 1.3): the brand wordmark in the header. Not used for section headings; those
  take the Engraved role.
- **Body** (400, 0.9375rem, 1.5): row content and prose. Prose caps at 68ch; rows and tabular data
  are exempt and may run the full column width.
- **Label** (500, 0.8125rem, 1.2): control labels.
- **Data** (mono 400, 0.8125rem, 1.45): URLs, payload bodies, headers JSON, token prefixes.
- **Engraved** (600, 0.6875rem, 1, 0.07em, uppercase): section legends, field labels, tab labels,
  and lamp legends. The faceplate legend stamped into metal.

### Named Rules

**The Machine Voice Rule.** Monospace means machine-authored and character-exact. Never use it for
emphasis, for headings, or for a Channel slug. Never set a payload body in the sans.

**The Engraved Role Rule.** Uppercase belongs to the Engraved role and nowhere else. Section
legends, field labels, tab labels, and lamp legends are uppercase and tracked at 0.07em, which
capitals need. Control labels, headings, prose, and switch labels stay sentence case: `Load more`,
not `LOAD MORE`; `Mint new token`, not `Mint New Token`.

**The Domain Word Rule.** Channel, Endpoint, Broadcast, Replay, Delivery, and Attempt are proper
nouns of this system and are capitalized in UI copy, exactly as in `CONTEXT.md`. Never "event",
"message", "job", "topic", "subscriber", or "target".

**The Tabular Numerals Rule.** Any number an operator compares down a column (durations, status
codes, percentages, timestamps, counts) carries `font-variant-numeric: tabular-nums`. Proportional
digits defeat the alignment the row grid exists to create.

## 4. Elevation

Depth here is **mechanical, not atmospheric**. There are no drop shadows in this system. What
replaces them is the lip: an inner highlight and an inner shade, plus at most a single zero-blur 1px
edge beneath a raised control.

The distinction is exact and it is the whole doctrine:

- **Raised** (a control, a row, a faceplate, the header): `inset 0 1px 0` highlight, optionally
  `0 1px 0` shade beneath. Zero blur. This is a milled edge catching light.
- **Pressed** (`:active` on a control or row): `inset 0 2px 3px` shade. The plate sinks.
- **Recessed** (a field, a well, a payload block, an empty state, a confirm region): `inset 0 1px
2px` shade. Light falls into the cut.

Containment reads inward, in this order: Plate page ground → Face faceplate → Face row → Well
expanded detail. Never lighter and lifted.

### Named Rules

**The No Drop Shadow Rule.** A `box-shadow` with a non-zero offset and a blur, cast _outside_ the
element, is prohibited. If a surface looks like it is hovering, delete the shadow and score a line.
The single permitted outside shadow is the `0 1px 0` zero-blur edge under a raised control.

**The Inward Depth Rule.** Nested detail goes darker, tighter, and inset, never lighter and lifted.
An expanded Broadcast payload sits in a Well, inset from its row. It does not float above it.

**The Lip Direction Rule.** Highlight on top means raised; shade on top means recessed. A control
with the field's shadow, or a field with the control's, reads as the wrong kind of object and is a
defect rather than a variation.

**Overlays** still do not exist, and this document does not grant them. Inline expansion remains the
answer for detail: Broadcast detail, Delivery detail, and Endpoint editing all expand in place. If a
floating surface is ever genuinely earned (a filter dropdown, a command palette, a tooltip on a
truncated header), its _behavior_ comes from the individual headless `radix-ui` primitive (focus
moves in on open, is trapped while open, returns to the trigger on close; `Escape` dismisses; a
press outside dismisses; the trigger carries `aria-expanded`), its _appearance_ comes from this
document, and it earns exactly one shadow token added to this section first, not invented at the
call site. ADR 0013 records why no pre-styled kit.

## 5. Components

Character across the board: **legible and unambiguous**. Every control states its affordance at
rest. Nothing is discovered by hovering. A border that only appears on hover is a defect here, not
restraint, because an operator scanning for the third time should not have to re-find the controls.

### Controls

`button` carries **no appearance of its own**. Geometry and color live entirely on the `.control`
classes, so a control looks identical whether it renders as a `button`, an `a`, or a router `Link`,
and an element that is a `button` for semantic reasons (a whole clickable row) inherits nothing it
must undo. This is not a style preference: the previous system styled the bare `button` element and
broke both ways, giving `<Link className="button-ghost">` no radius, no padding, and an underline,
while `.channel-row` inherited the primary button's hover fill and turned an entire row unreadable.

- **Shape:** 2px radius, 8px by 14px, Label typography, sentence case, sized by its own label and
  never stretched by a flex or grid parent.
- **Default:** Face ground, 1px Score Control, inner top highlight, 1px shade beneath. Present at
  rest.
- **Primary:** Anodize ground, Anodize Ink text, weight 600. Reserved for the single committing
  action in a plate: Save changes, Add Endpoint, Mint new token, Retry, Sign in. One per plate,
  never two.
- **Commit (destructive):** outlined Anodize, weight 600, for the moment a destructive action fires
  (Confirm revoke, Confirm delete). Form carries the difference, the same way the lamps use it. Never
  a lamp color; The Quarantine Rule forbids red on a control.
- **Hover:** ground goes to Well, border to Ink Muted. 150ms on `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Active:** the lip inverts to an inner shade, with **no transition** and no `transform`. Real
  hardware does not ease, and a control that moves also nudges its neighbours' baselines.
- **Focus:** 2px Anodize ring at 2px offset, on every control, via `:focus-visible`.
- **Disabled:** 45% opacity, `cursor: not-allowed`, no hover response, lip flattened.
- **Pending:** the label is replaced ("Saving…", "Replaying…", "Minting…"), never supplemented with a
  spinner.

### Icons

One family: **`lucide-react`**, imported per glyph. 1.5 to 2 stroke, sized 13px in controls and tabs,
14px in inline text, 11px inside a lamp glass (where the stroke steps up to 2.25 to hold its shape),
20px in an empty state. Every decorative glyph carries `aria-hidden="true"`; no control is
icon-only except the theme toggle, which carries a full `aria-label` naming both the current state
and the consequence of pressing.

Glyphs are semantic, never decorative. The vocabulary: `Check` / `X` / `Ban` / `LoaderCircle` /
`Clock` / `Power` / `Minus` for lamp states; `RotateCcw` Replay, `Repeat` Retry, `Copy`, `Power`
Re-enable, `ShieldOff` Revoke, `KeyRound` Mint, `Trash2` Delete, `Check` Save, `X` Cancel for
actions; `Radio` Channel, `Activity`, `Plug` Endpoint, `SlidersHorizontal` Settings, `KeyRound`
Tokens, `Link2` Ingest URL, `Plus` New, `Filter`, `ArrowLeft` Back, `ChevronRight`/`ChevronDown`
disclosure, `Inbox` empty, `SearchX` not found, `Info` advisory, `TriangleAlert` warning,
`Sun`/`Moon`/`Monitor` theme.

**Do not introduce a second icon set.** Mixing families is visible immediately at this size.

### Lamps (signature component)

The status lamp replaces the pill entirely. A 17px round glass in a 1px bezel, holding an 11px
glyph, with a tracked-caps legend beside it.

It carries the same fact four independent ways, and color is only the fourth:

1. the **glyph's shape** (a check is not a cross is not a slash is not a clock),
2. the **glass's form** (`lit`, filled with its tone; or `hollow`, an unlit bezel),
3. the **text legend**, always present and always announced,
4. the **tone's color**.

Remove color entirely and every state stays unambiguous, which is what PRODUCT.md requires as a hard
constraint. It is also what separates the two most confusable Delivery states: `PENDING` waits behind
a hollow clock, `IN PROGRESS` turns inside a lit ring.

| State                             | Tone    | Form   | Glyph        |
| --------------------------------- | ------- | ------ | ------------ |
| `succeeded`, enabled, no failures | Live    | lit    | check        |
| `failed`, failing Channel         | Cut     | lit    | cross        |
| `dead_lettered`                   | Cut     | lit    | slash        |
| auto-disabled Endpoint            | Cut     | hollow | slash        |
| `in_progress`                     | neutral | lit    | turning ring |
| `pending`                         | neutral | hollow | clock        |
| disabled (a choice, not a fault)  | neutral | hollow | power        |
| no activity, no Endpoints         | neutral | hollow | minus        |

A lamp is **read-only**. It is never a button and never a filter.

**The fan-out lamp.** A Broadcast row's lamp reports a whole fan-out rather than one Delivery, so it
reduces several Delivery states to one. The order below is the rule, and it exists because the first
version of it collapsed everything that was not dead-lettered into Lamp Live: filtering a Channel to
failures then produced a screen of green check lamps, each sitting directly above a red `FAILED`
Delivery.

| Fan-out              | Tone    | Form   | Glyph        | Legend                     |
| -------------------- | ------- | ------ | ------------ | -------------------------- |
| no enabled Endpoints | neutral | hollow | minus        | `No Endpoints`             |
| any `dead_lettered`  | Cut     | lit    | slash        | `N dead-lettered`          |
| any `failed`         | Cut     | lit    | cross        | `N failed, X/Y succeeded`  |
| any `pending`        | neutral | lit    | turning ring | `N pending, X/Y succeeded` |
| all `succeeded`      | Live    | lit    | check        | `X/Y succeeded`            |

`failed` and `dead_lettered` are **both terminal** (ADR 0003), which is why both are Cut. They differ
in cause, not in finality: a non-retryable outcome finishes as `failed` and is never retried, while a
retryable one that spends its budget finishes as `dead_lettered` and is the only one offered a Retry.
The cross and the slash keep them apart without color. A Delivery still owed a retry is `pending`,
never `failed`, so the turning ring is the only branch that may claim work outstanding.

**The Agreement Rule.** Any predicate that decides a Broadcast is a failure and any lamp that paints
one must read the same fact. If `fanoutHasFailure` admits a row to the failures-only filter, the lamp
on that row may not report it as healthy. A parent that disagrees with its own children is the one
defect this surface cannot afford, because the whole product is a claim to be telling the truth.

### Rows

The unit the dashboard exists to display, and the thing an operator scans twenty of at a time.

- A grid, with a **constant leading lamp column** (`--status-lamp-column`) shared by every row family
  (Channel, Endpoint, Broadcast, Delivery), so a lamp lands at the same x whichever list it scrolls
  past in and the eye can run the column without reading.
- **The grid belongs to the list, not to the row.** Tracks are declared once on the `<ul>`
  (`.row-list-channel`, `.row-list-activity`); the `<li>` is `display: contents` and the row itself
  takes `grid-template-columns: subgrid`, so it keeps its own ground, border, radius, hover, and
  focus ring while its tracks are sized across every sibling. When each row was its own grid, only
  the leading track was actually pinned: a `1fr` description track let the widest health legend push
  everything after it sideways, and the Channel directory's health lamp measured a **141px spread**
  across seven rows, worst on exactly the rows that were broken. A second constant,
  `--health-lamp-column`, pins that lamp the way `--status-lamp-column` pins the leading one. The
  per-row `grid-template-columns` stays as a standalone fallback, because `subgrid` with no grid
  ancestor supplying the axis has no tracks to inherit and collapses the row.
- **A row family owns its own tracks.** Channel, Activity, Endpoint, Delivery, and Token each declare
  their own, and a family may not borrow another's because the number of columns happens to match.
  Endpoint rows borrowed the Channel directory's and inherited its ranking, where the flexible column
  is the description and the trailing lamp is pinned wide. An Endpoint ranks the opposite way: its
  identity is the URL, and the statistics beside it are what may yield. Shared across a list, the
  borrowed tracks resolved those statistics at max-content and left the URL 64px of the 291px it
  wanted, rendering it as `https://…`. **What a column means decides its track, and two lists that
  look alike are not therefore the same family.**
- **Identity never yields to metadata.** In every family, the column carrying the thing an operator
  identifies the row by (a Channel slug, an Endpoint URL) gets the flexible remainder and a pinned
  minimum. Counts, durations, and timestamps truncate first. Where a value can still outrun its
  column, it carries a `title` so the full string is reachable without opening an editor to read it.
- **The breakpoint has to outrank the list.** Below 720px the list stops being a grid and its items
  get their boxes back before the rows collapse to stacked lines, in that order: while the list is a
  grid and its items are `display: contents`, a row's own `grid-template-columns` does not decide
  where its children land. The collapse rules carry the same two-class weight as the `.row-list-*
.row-*` rules they override, because a media query contributes no specificity of its own and a
  single-class rule inside one loses at every width.
- Face ground on the plate ground, 1px Score, 3px radius, inner top highlight. A strip on the plate,
  not an object floating above it.
- **Hover** tints to Well and darkens the border. It does **not** fill with the accent: the row
  reports system state, and the accent belongs to the selected row.
- **Selected or expanded** (`aria-expanded="true"`): Anodize Wash ground, Anodize border. Nothing
  else in the system uses that wash.
- **What the row does decides its element.** A row that navigates is an `a` (a router `Link`), so
  cmd-click, middle-click, "open in new tab", "copy link address", the hover URL preview, and the
  screen reader's "link" announcement all come for free; a Channel directory row is one. A row that
  expands in place is a `button` carrying `aria-expanded`; Activity and Endpoint rows are those. The
  `.row` classes carry the whole appearance either way, so the swap is a change of element and never
  of look — including `text-decoration: none`, without which an anchor row arrives underlined, the
  same failure the Controls note above records.
- An expandable row ends with a **disclosure chevron**, so whether it opens and whether it is open
  now are shapes at rest rather than discoveries.
- **Expanded** detail is a Well, inset from the row, holding the full Endpoint URL, the last error in
  Lamp Cut, and the numbered Attempt timeline. Retry appears there, and only when the status is
  `dead_lettered`. Separated by a full 1px scored border, never a colored leading stripe.

### Plates and wells

Faceplates, not cards. The distinction matters: a card is an object you might click, a plate is a
region that holds content. Nothing in this system is a clickable card.

- **Plate:** Face on Plate, 1px Score, 3px radius, 20px padding, inner top highlight, no drop
  shadow. Prose-shaped plates cap at 72ch; a plate holding a machine string (the ingest URL) opts out
  with `.plate-wide`.
- **Well:** Well ground, 1px Score, 3px radius, 12px padding, inner shade. Every nested detail region:
  expanded Broadcast, expanded Delivery, Endpoint edit form, confirm region, advisory, empty state.
- **Plates never nest.** A plate inside a plate is always wrong. Nested content becomes a well.
- Padding tightens as nesting deepens (20px plate, 12px row, 12px well, 6px by 8px Attempt row).
  That rhythm is what signals depth.

### Section legends

A list region draws **no box**. Its heading is an engraved legend (glyph, tracked caps, Ink Muted)
with a **groove** running out from it to the full width: a 1px scored line with a 1px highlight
beneath it. That is what replaced the panel border around row lists, which had been wrapping content
already delimited row by row in a second layer of chrome.

### Fields

- **Field:** Well ground, 1px Score Control (visible at rest, which is the point), 2px radius, 8px by
  10px, Body typography, inner shade falling from the top edge. The inverse of a control.
- **Label:** the Engraved role, above the field, always present. No placeholder-as-label. Set tight to
  its own field (6px) and a full step from the next field (16px), so a label belongs visibly to what
  it names.
- **Field pair:** two short fields share a line (Name and Timeout), so a form is not an
  undifferentiated column of identical full-width wells.
- **Focus:** border goes Anodize with a 2px Anodize ring inset 2px. Border color only; the field must
  not resize or shift.
- **Error:** border goes Lamp Cut, message beneath in Lamp Cut at Label size with a warning glyph and
  `role="alert"`. The message names the constraint in the system's own voice: _"Headers must be valid
  JSON (e.g. {"x-api-key": "secret"})"_, never _"Invalid input"_. It sits under the field it belongs
  to, never as one string at the foot of the form, and the field carries `aria-invalid` with
  `aria-describedby` pointing at the message. Timing is governed by the Reward-Early-Punish-Late Rule
  below.
- **Textarea:** identical treatment, `resize: vertical` only.

### Switch plates

A boolean is a **switch plate**, not a native checkbox. The native control was the one element on
this surface drawn entirely by the platform: a saturated blue square belonging to no palette here.

The real `input` stays in the tree, stays what the `label` points at, and stays what the keyboard
toggles; it is drawn over rather than replaced, so `Space`, `:checked`, `:disabled`, and form
semantics remain the browser's own. A 34px by 20px well holds a 14px plunger that **throws from left
to right** when checked, while the well goes Anodize. Position carries the state, so which way the
switch is thrown survives color being removed.

### Navigation

The shell is a full-width sticky header over a single scrolling column. There is no sidebar; at this
scale a sidebar would be chrome standing in for structure.

- **The document is the one scroll container.** No nested `overflow-y: auto` region, which had
  produced a second scrollbar inset from the viewport edge with the header out of step with the
  content it sat above.
- **Header:** Face, 1px Score bottom border, with the content column aligned inside it by
  `.app-header-inner` so the brand sits over the content and not over the ground beside it. Brand
  (glyph plus wordmark) at Title size on the left; theme toggle and Log out on the right.
- **Content column:** 1080px. Narrowed from 1180px, which was wide enough that the roughly 620px
  plates left a third of the column as dead ground.
- **Tabs:** the Engraved role on a scored baseline, each with its domain glyph. The active tab is
  Anodize with a 2px Anodize bottom border overlapping that baseline.
- **Back navigation:** an explicit control with a left-arrow glyph (`Back to Channels`), wrapped so it
  is sized by its label rather than stretched to the column width, never a bare chevron.
- **Responsive:** below 720px row grids collapse to stacked lines and metadata wraps rather than
  truncating. The layout composes; it does not shrink.

### Loading, empty, and error

- **Loading:** skeleton rows that preview the shape of what is coming, pulsing on opacity only, with
  `role="status"` and a label. Never a centered "Loading…" where content is about to be. Governed by
  the No-Flicker Rule below.
- **Empty:** a dashed Score Strong well, one muted glyph, and copy that teaches the next action in
  the domain's own words: _"No Broadcasts yet. Send a request to `POST /ingest/<slug>` with a Channel
  token."_ Never _"Nothing here."_ No illustration, ever.
- **Error:** inline, in Lamp Cut, with a warning glyph, `role="alert"`, and a Retry control beside the
  message.
- **Advisory** (a consequence that is neither a failure nor a validation error): a recessed well with
  an info glyph in Ink. It may not borrow a lamp color, and it may not be a live region.

#### Named Rules

**The No-Flicker Rule.** No representation of waiting may ever appear and disappear inside a blink.
Two thresholds, applied together, to every one of them:

- **Delay 250ms before showing.** If the work resolves first, no loading state is ever rendered. The
  operator sees the row list, the panel, or the updated control appear as though it were already
  there. Most requests against a healthy local fan-out land inside this window, so the common case is
  a screen that simply does not flicker.
- **Hold 400ms once shown.** After the loading state has been committed to the screen, it stays for
  at least that long, even when the response arrives 10ms later. The hold applies to whatever
  replaces it: content, an empty state, or an error.

This governs every representation of waiting, with no exemption for controls. A Retry, Replay, Save,
or Mint control that resolves in 80ms does not blink its pending state; the row underneath it just
changes. A control that is genuinely slow shows its pending state at 250ms and holds it. The
operator's own clicks are the most frequent source of sub-100ms waits, which makes them the most
frequent source of flicker, not an exception to it.

Why it is a rule and not a preference: a skeleton that exists for three frames is not information,
it is a twitch. PRODUCT.md asks for an instrument that stays calm while reporting failure, and
nothing undermines that faster than a surface that strobes at every interaction. It also removes an
entire class of false signal, where an operator perceives flicker as instability in the fan-out
rather than in the dashboard.

Consequence for state: `isPending` from the data layer is never bound straight to a rendered loading
state. It passes through the shared delay-and-hold hook first, and that hook's output is the only
thing components read. The two thresholds live as tokens, not as literals scattered across call
sites.

**The Reward-Early-Punish-Late Rule.** A field validates locally against the contract schema on every
keystroke, but when it shows the result depends on whether the operator has finished with it:

- **Silent on first pass.** While a field is being filled for the first time, it shows nothing. Half
  of `https://example.com/hook` is not a URL and `{"x-api` is not JSON, so validating visibly as they
  type would put a field in an error state for most of the time it takes to fill it correctly.
- **Announce on blur, or on submit.** Leaving a field with an invalid value marks it: Lamp Cut
  border, message beneath, `aria-invalid`. A submit attempt marks every invalid field at once and
  moves focus to the first of them, so the operator never has to guess where the form stopped.
- **Live once marked.** After a field is showing an error, it re-validates on every keystroke and
  clears the moment the value becomes valid. Correction gets instant feedback; composition does not.

The two halves are one rule. Deferring the first announcement is what makes clearing it immediately
affordable, and clearing it immediately is what keeps the deferral from reading as the surface
withholding what it already knows.

Consequence for state: the submit control is not disabled to express invalidity. A control that is
dead with no stated reason is worse than a control that explains what is wrong when pressed, and it
is the one path by which an operator can force every message onto the screen at once. It disables
only while a request is genuinely in flight.

This is where the No-Flicker Rule stops applying. That rule governs representations of *waiting*,
and local validation does not wait for anything; a message that has been earned appears on the
frame it is earned on, with no delay and no hold. What replaces the round trip is not a faster
loading state, it is the absence of one.

### Theme control

Three states, because "follow the OS" is a real answer and not the absence of one: `system` leaves
the root element unstamped and lets `prefers-color-scheme` decide; `light` and `dark` stamp
`data-theme` and win over it in both directions. Persisted in `localStorage`, with the read and write
both guarded so blocked storage degrades to a session-only preference. It lives in the header, not in
Settings: it is a viewing preference of this browser, not Channel configuration.

## 6. Do's and Don'ts

### Do:

- **Do** tint every neutral toward hue 195 at chroma 0.002 to 0.011.
- **Do** keep Anodize under 10% of any screen, and only on operator actions, the active tab, the
  active filter, focus rings, and selection.
- **Do** carry every status four ways: glyph, form, legend, color. PRODUCT.md makes this a hard
  requirement: _"Status is never encoded in color alone."_
- **Do** define every new color in both themes, in the same commit.
- **Do** put geometry on `.control`, never on the bare `button` element, so a `Link` styled as a
  control is indistinguishable from a `button` styled as one.
- **Do** use monospace only for machine-exact strings: URLs, payload bodies, headers JSON, token
  prefixes, ingest paths, body previews.
- **Do** use `tabular-nums` on any number compared down a column.
- **Do** express depth with the lip and with tone: highlight-on-top for raised, shade-on-top for
  recessed.
- **Do** write UI copy in `CONTEXT.md`'s vocabulary, capitalized: Channel, Endpoint, Broadcast,
  Replay, Delivery, Attempt.
- **Do** name the constraint in every error message: the endpoint, the status code, the attempt.
- **Do** keep transitions at 120 to 200ms on color, opacity, and a switch's `left`, easing out with
  `cubic-bezier(0.22, 1, 0.36, 1)`, and keep `:active` instantaneous.
- **Do** put every loading state behind the shared delay-and-hold hook: 250ms before it may appear,
  400ms minimum once it has. See the No-Flicker Rule in §5.
- **Do** validate against the contract schema in the browser, anchor the message to its own field,
  and show it on blur or submit rather than mid-keystroke. See the Reward-Early-Punish-Late Rule
  in §5.

### Don't:

- **Don't** use `#ffffff`, `#000000`, or any untinted grey.
- **Don't** use an 8px radius, or any radius above 3px, on anything but a lamp's glass. The rounded
  rectangle is the tell this system exists to remove.
- **Don't** use a pill shape for a status. Pills are gone; lamps replaced them.
- **Don't** style the bare `button` element. It is reset on purpose.
- **Don't** cast a blurred, offset shadow outside any element. The only outside shadow permitted is
  the `0 1px 0` zero-blur edge under a raised control.
- **Don't** give a control the field's inner shade at rest, or a field the control's highlight. The
  lip direction is what says which kind of object it is.
- **Don't** nest an `overflow-y: auto` region inside the page. The document scrolls.
- **Don't** use `border-left` or `border-right` above 1px as a colored stripe.
- **Don't** put Lamp Live or Lamp Cut on a control, a link, a heading, or a non-status border. Red
  belongs on a `DEAD LETTERED` lamp, never on the plate that contains it.
- **Don't** nest a plate inside a plate. Nested detail becomes a well.
- **Don't** reach for a modal. Broadcast detail, Delivery detail, and Endpoint editing are all inline
  expansions, and every future detail view should be too.
- **Don't** add a second icon family alongside `lucide-react`, and don't use a glyph decoratively.
- **Don't** ship an icon-only control without an `aria-label` that names its state and its
  consequence.
- **Don't** use a native checkbox or radio. Switch plates carry booleans.
- **Don't** add a pre-styled component kit (shadcn/ui, MUI, Mantine) to `apps/web`. Each ships its own
  shadows, untinted greys, radii, and status variants, so adopting one means overriding it at every
  point this document has an opinion. Overlay _behavior_ comes from headless `radix-ui` primitives
  dressed in these classes; see §4 and ADR 0013.
- **Don't** render a skeleton, spinner, or pending control directly from a query's or mutation's
  `isPending`. Unfiltered, it flashes on every fast response, which is most of them.
- **Don't** exempt a control's own pending state from the delay, on the argument that the operator
  just clicked it. A click that resolves in 80ms should produce a changed row, not a blink.
- **Don't** send a request whose only possible outcome is a validation rejection the browser could
  have named, and don't collapse what comes back into one message at the foot of the form.
- **Don't** disable the submit control to express invalidity. It expresses in-flight, nothing else.
- **Don't** restate a contract constraint as a hand-written check in `apps/web`. Import the schema.
- **Don't** write reassurance copy. No "Oops", no "Something went wrong", no exclamation marks.
- **Don't** animate layout properties on elements that affect their siblings, add bounce or elastic
  easing, or animate anything that is not a state change.
- **Don't** use `text-transform: uppercase` outside the Engraved role.
