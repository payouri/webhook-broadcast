---
name: webhook-broadcast
description: Operator console for a single-tenant webhook multiplexer, built as a lit switchboard rather than a dark monitoring wall.
colors:
  paper: "oklch(97.2% 0.006 75)"
  surface: "oklch(99% 0.004 75)"
  surface-sunk: "oklch(95.4% 0.007 75)"
  hairline: "oklch(89% 0.008 75)"
  hairline-strong: "oklch(80.5% 0.01 75)"
  ink: "oklch(24% 0.012 75)"
  ink-muted: "oklch(52% 0.012 75)"
  patch-plum: "oklch(46% 0.14 325)"
  patch-plum-deep: "oklch(39% 0.13 325)"
  patch-plum-wash: "oklch(95% 0.03 325)"
  signal-live: "oklch(52% 0.13 150)"
  signal-live-wash: "oklch(94% 0.04 150)"
  signal-cut: "oklch(50% 0.17 27)"
  signal-cut-wash: "oklch(94% 0.045 27)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
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
    lineHeight: 1.4
    letterSpacing: "normal"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  stamp:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.patch-plum}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.patch-plum-deep}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-sunk}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "0"
    padding: "8px 4px"
  tab-active:
    textColor: "{colors.patch-plum}"
  row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  row-hover:
    backgroundColor: "{colors.surface-sunk}"
  status-succeeded:
    backgroundColor: "{colors.signal-live-wash}"
    textColor: "{colors.signal-live}"
    typography: "{typography.stamp}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  status-failed:
    backgroundColor: "{colors.signal-cut-wash}"
    textColor: "{colors.signal-cut}"
    typography: "{typography.stamp}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  status-in-progress:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  status-pending:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.stamp}"
    rounded: "{rounded.pill}"
    padding: "2px 7px"
---

# Design System: webhook-broadcast

## 1. Overview

**Creative North Star: "The Switchboard"**

A switchboard is one incoming line patched out to many, which is exactly what this product does. It
is also a piece of equipment an operator sits at rather than monitors from across a room: the whole
board is in arm's reach, every line's state is readable at a glance, and the connections are
physically traceable. Nothing is hidden behind a menu, because on a real board nothing can be.

That metaphor sets the ground. This interface is lit, not dark. It is built for two or three
engineers at their desks in a working office, mid-morning, with the dashboard in a browser tab
beside their editor and terminal. Warm paper neutrals (a faint hue-75 tint through every grey) put
it closer to a printed log book than to a wall of gauges. A single wine-ink accent, Patch Plum,
carries every operator action and every current selection. Green and red appear only as status,
never as decoration and never as the accent, so "healthy" can never be confused with "selected".

The system is flat and drawn entirely with hairlines. Depth comes from tone, not shadow. Structure
comes from alignment, not boxes. It rejects the two things PRODUCT.md named: **enterprise
monitoring dread** (walls of red gauges, undifferentiated dense config panels, density with no
ranking) and **consumer SaaS marketing bleed** (gradients, illustrations, friendly mascots,
hero-metric tiles). Density is a goal here. Density without hierarchy is the failure.

**Key Characteristics:**

- Light, warm-neutral ground; a lit desk, not a dim NOC
- Restrained color: one accent under 10% of any screen, status colors quarantined to status
- Flat by doctrine, zero shadows, 1px hairlines and two-tone surfaces only
- Single system sans, with monospace reserved for machine-shaped content
- Row-first layout: rows are the content, chrome recedes
- Every state readable without color

## 2. Colors: The Switchboard Palette

Warm paper and hairline greys, one wine-ink accent for operator intent, two signal colors held in
reserve for delivery state.

### Primary

- **Patch Plum** (`oklch(46% 0.14 325)`): the operator's own voice. Primary buttons (Save changes,
  Mint new token, Retry), the active tab underline, focus rings, and the hover border on
  interactive rows. It marks what the operator is doing or has selected. It never marks what the
  system is reporting.
- **Patch Plum Deep** (`oklch(39% 0.13 325)`): pressed and hovered states of primary buttons only.
- **Patch Plum Wash** (`oklch(95% 0.03 325)`): the tinted background of a selected or expanded row.
  Used to show which Broadcast is open beneath the cursor, nothing else.

### Secondary

Deliberately absent. Restrained means one accent. A second accent would compete with the signal
colors for meaning, and meaning is the scarce resource on this surface.

### Tertiary

- **Signal Live** (`oklch(52% 0.13 150)`) on **Signal Live Wash** (`oklch(94% 0.04 150)`): a
  Delivery that succeeded, an Endpoint or Channel that is enabled.
- **Signal Cut** (`oklch(50% 0.17 27)`) on **Signal Cut Wash** (`oklch(94% 0.045 27)`): a Delivery
  that failed or dead-lettered, an auto-disabled Endpoint, a form validation error, an Attempt that
  errored.

These two are the only saturated colors permitted outside the accent. They are a vocabulary, not a
palette: they attach to state and nothing else.

### Neutral

- **Paper** (`oklch(97.2% 0.006 75)`): the page ground. Warm, faintly ochre, never white.
- **Surface** (`oklch(99% 0.004 75)`): raised content. Panels, the app header, input fields, rows.
  It is the lightest value in the system and it is still not white.
- **Surface Sunk** (`oklch(95.4% 0.007 75)`): recessed content. Code and payload blocks, hovered
  rows, the neutral status stamp.
- **Hairline** (`oklch(89% 0.008 75)`): every default border and divider, always 1px.
- **Hairline Strong** (`oklch(80.5% 0.01 75)`): borders that must survive against Surface Sunk, and
  the resting border of form controls, which must be visible without hover.
- **Ink** (`oklch(24% 0.012 75)`): all primary text. Warm near-black, never `#000`.
- **Ink Muted** (`oklch(52% 0.012 75)`): timestamps, secondary metadata, field labels, placeholder
  text, and the `pending` status stamp.

### Named Rules

**The One Voice Rule.** Patch Plum covers no more than 10% of any screen and only ever means "the
operator did this or chose this". If an element is reporting system state, it may not be plum.

**The Quarantine Rule.** Signal Live and Signal Cut attach to Delivery status, Attempt outcome, and
enabled state. They are forbidden on buttons, links, headings, borders of non-status elements, and
anything decorative. A red border on a card is a violation; a red `DEAD LETTERED` stamp is correct.

**The Warm Grey Rule.** Every neutral carries hue 75 at chroma 0.004 to 0.012. There is no `#fff`,
no `#000`, and no untinted grey anywhere in this system. If a grey looks blue, it is wrong.

## 3. Typography

**Display Font:** none. This system has no display face and does not want one.
**Body Font:** system UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
Arial, sans-serif`)
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

**Character:** one native sans doing every job, at a tight 1.15 to 1.25 ratio, so that hierarchy
reads as rank rather than as drama. The monospace face is the second voice and it is strictly
semantic: it means "this string came from a machine and its exact characters matter". A URL, a
payload body, an outbound header, a token prefix, and an ingest path are monospace. A Channel slug,
a timestamp, a duration, and a status code are not; they are read, not copied.

### Hierarchy

- **Headline** (600, 1.25rem, 1.25, -0.01em): the Channel slug on Channel detail, and the product
  name in the app header. One per screen.
- **Title** (600, 1rem, 1.3): panel headings. Activity, Endpoints, Ingest tokens, New Endpoint.
- **Body** (400, 0.9375rem, 1.5): row content and prose. Prose caps at 70ch; rows and tabular data
  are exempt and may run to the full column width.
- **Label** (500, 0.8125rem, 1.4): form labels, buttons, tabs, and inline metadata. Sentence case.
- **Data** (mono 400, 0.8125rem, 1.45): URLs, payload bodies, headers JSON, token prefixes.
- **Stamp** (600, 0.6875rem, 1, 0.04em, uppercase): status pills only. Delivery status, auto-disabled
  markers.

### Named Rules

**The Machine Voice Rule.** Monospace means machine-authored and character-exact. Never use it for
emphasis, for headings, or for a Channel slug. Never set a payload body in the sans.

**The Sentence Case Rule.** Every label, button, tab, and heading is sentence case. The only
uppercase in the system is the Stamp role. `Load more`, not `LOAD MORE`. `Mint new token`, not
`Mint New Token`.

**The Domain Word Rule.** Channel, Endpoint, Broadcast, Replay, Delivery, and Attempt are proper
nouns of this system and are capitalized in UI copy, exactly as in `CONTEXT.md`. Never "event",
"message", "job", "topic", "subscriber", or "target".

## 4. Elevation

There are no shadows in this system. None. Depth is expressed entirely through a three-step tonal
stack (Surface Sunk, Paper, Surface) and 1px hairlines, which is how the interface stays legible at
high density: a shadow at every level would turn twenty Delivery rows into twenty floating objects,
and the Broadcast-to-Delivery-to-Attempt nesting would read as sediment.

Hierarchy of containment is drawn instead by indentation and hairline, in this order: Paper page →
Surface panel → Surface row → Surface Sunk expanded detail. Depth reads inward, not upward.

### Shadow Vocabulary

Not applicable. If a future floating surface genuinely requires separation from content beneath it
(a dropdown, a popover, a command palette), it earns exactly one shadow token at that time and it
must be introduced here first, not invented at the call site.

### Named Rules

**The No Shadow Rule.** `box-shadow` is prohibited except as a focus ring. A drop shadow on a card,
row, panel, button, or input is always a defect, never a style choice.

**The Inward Depth Rule.** Nested detail goes darker and indented, never lighter and lifted. An
expanded Broadcast payload sits on Surface Sunk, inset from its row. It does not float above it.

**The Anti-2014 Test.** If a surface looks like it is hovering, the shadow that should not be there
is there. Delete it and add a hairline.

## 5. Components

Character across the board: **legible and unambiguous**. Every control states its affordance at
rest. Nothing is discovered by hovering. A border that only appears on hover is a defect here, not
restraint, because an operator scanning for the third time should not have to re-find the controls.

### Buttons

- **Shape:** softly squared corners (8px, `{rounded.md}`), 9px vertical by 16px horizontal padding,
  Label typography (500, 0.8125rem), sentence case.
- **Primary:** Patch Plum ground, Surface text. Reserved for the single committing action in a
  panel: Save changes, Add Endpoint, Mint new token, Retry. One per panel, never two.
- **Ghost:** Surface ground, Ink text, 1px Hairline Strong border. Everything non-committing: Back
  to Channels, Cancel, Revoke, Replay, Load more, Log out. The border is present at rest.
- **Hover:** Primary darkens to Patch Plum Deep; Ghost fills to Surface Sunk and its border darkens.
  Background and border color only, 150ms, `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Focus:** 2px Patch Plum ring at 2px offset, on every button without exception.
- **Disabled:** 45% opacity, `cursor: not-allowed`, no hover response. Pending-action labels
  ("Saving…", "Replaying…", "Minting…") replace the label rather than adding a spinner.

### Chips

Status stamps are the only chip in this system, and they are read-only. They never act as filters
or as buttons.

- **Style:** pill (999px), 3px by 8px, Stamp typography (600, 0.6875rem, uppercase, 0.04em).
- **State:** `SUCCEEDED` is Signal Live on Signal Live Wash. `FAILED` and `DEAD LETTERED` are Signal
  Cut on Signal Cut Wash. `IN PROGRESS` is Ink on Surface Sunk, filled. `PENDING` is Ink Muted on
  transparent with a 1px Hairline Strong border, outlined.

The pending/in-progress pair differs by **form** (outlined versus filled) as well as by label, so
the two most easily confused states stay distinguishable with color removed entirely.

### Cards / Containers

Panels, not cards. The distinction matters: a card is an object you might click, a panel is a region
that holds content. Nothing in this system is a clickable card.

- **Corner Style:** 12px (`{rounded.lg}`) on panels, 8px on rows inside them.
- **Background:** Surface on Paper.
- **Shadow Strategy:** none, per Elevation.
- **Border:** 1px Hairline.
- **Internal Padding:** 20px on panels, 10px by 12px on rows, 6px by 8px on Attempt rows. Padding
  tightens as nesting deepens; this is the rhythm that signals depth.

**Panels never nest.** A panel inside a panel is always wrong. Nested content becomes an inset
Surface Sunk region with a hairline, not a second panel.

### Inputs / Fields

- **Style:** Surface ground, 1px Hairline Strong border (visible at rest, which is the point), 8px
  radius, 9px by 12px padding, Body typography. Full width within its panel.
- **Label:** Label typography in Ink Muted, above the field, always present. No placeholder-as-label.
- **Focus:** border goes Patch Plum and a 2px Patch Plum ring appears at 1px inset. Border color
  only; the field must not resize or shift.
- **Error:** border goes Signal Cut, with the message beneath in Signal Cut at Label size, carrying
  `role="alert"`. The message names the constraint, in the system's own voice: *"Headers must be
  valid JSON (e.g. {"x-api-key": "secret"})"*, never *"Invalid input"*.
- **Disabled:** Surface Sunk ground, Ink Muted text, Hairline border.
- **Textarea:** identical treatment, `resize: vertical` only.

### Navigation

The shell is a fixed header over a single scrolling column, with tabs as the only second-level
navigation. There is no sidebar; at this scale a sidebar would be chrome standing in for structure.

- **Header:** Surface, 1px Hairline bottom border, 16px by 24px. Product name at Headline size on
  the left, acting as the route home. Log out as a Ghost button on the right.
- **Tabs:** Label typography, Ink Muted, 8px by 4px, sitting on a 1px Hairline baseline. Active tab
  is Patch Plum with a 2px Patch Plum bottom border overlapping that baseline. Hover moves an
  inactive tab to Ink with no background fill.
- **Back navigation:** an explicit Ghost button (`← Back to Channels`), never a bare chevron.
- **Responsive:** the content column is capped for prose readability but tabular regions (Delivery
  rows, Attempt rows, Endpoint rows) may extend to the full viewport width; the cap must not starve
  data of horizontal room. Below 640px, row grids collapse to stacked lines and metadata wraps
  rather than truncating.

### The Delivery Row (signature component)

The unit the whole dashboard exists to display, and the thing an operator scans twenty of at a time.

- Fixed leading column: the status stamp, at a constant width so stamps align vertically down the
  list and the eye can run the column without reading.
- Middle: Endpoint name or URL, monospace when it is a URL, truncating with ellipsis from the tail.
- Trailing: `HTTP 503 · 4213ms`, Ink Muted, right-aligned, never wrapping.
- Expanded: a Surface Sunk region, inset 10px from the left, holding the full Endpoint URL, the last
  error at Signal Cut, and the numbered Attempt timeline. Retry appears here, and only when the
  status is `dead_lettered`.
- The expanded region is separated by a full 1px Hairline border. Never a colored left stripe.

### Empty States

Dashed 1px Hairline Strong, 8px radius, 24px padding, centered, Body in Ink Muted. Each one teaches
the next action in the domain's own words: *"No Broadcasts yet. Send a request to
`POST /ingest/<slug>` with a Channel token."* Never *"Nothing here."* No illustration, ever.

## 6. Do's and Don'ts

### Do:

- **Do** tint every neutral toward hue 75 at chroma 0.004 to 0.012. Paper (`oklch(97.2% 0.006 75)`)
  and Surface (`oklch(99% 0.004 75)`) are the two ground tones; everything else is a hairline.
- **Do** keep Patch Plum (`oklch(46% 0.14 325)`) under 10% of any screen, and only on operator
  actions, the active tab, focus rings, and selection.
- **Do** pair every status color with a text label or a distinct form. PRODUCT.md makes this a hard
  requirement: *"Status is never encoded in color alone."* Outlined versus filled separates
  `PENDING` from `IN PROGRESS` with color removed.
- **Do** use monospace only for machine-exact strings: URLs, payload bodies, headers JSON, token
  prefixes, ingest paths.
- **Do** draw every boundary with a 1px hairline and express depth with tone and indentation.
- **Do** write UI copy in `CONTEXT.md`'s vocabulary, capitalized: Channel, Endpoint, Broadcast,
  Replay, Delivery, Attempt.
- **Do** name the constraint in every error message: the endpoint, the status code, the attempt.
- **Do** keep transitions at 150 to 200ms on color and opacity, easing out with
  `cubic-bezier(0.22, 1, 0.36, 1)`.

### Don't:

- **Don't** use `#ffffff` or `#000000`, or any untinted grey. The current `--surface: #ffffff` and
  the blue-grey `--border: #e2e5ea` in `apps/web/src/styles.css` are the exact violations this spec
  replaces.
- **Don't** use Tailwind indigo (`#4f46e5` / `#4338ca`) or any blue as the accent. It is the
  category reflex for this kind of tool and it currently collides with the `pending` status pill,
  which means "pending" and "selected" share a color.
- **Don't** use `border-left` or `border-right` above 1px as a colored stripe. The
  `border-left: 2px solid var(--primary)` on `.delivery-detail` is a banned side-stripe and must
  become a full hairline border with inset padding.
- **Don't** add `box-shadow` to anything but a focus ring. If a surface looks like it is hovering,
  delete the shadow and add a hairline.
- **Don't** build **enterprise monitoring dread**: walls of red gauges, undifferentiated dense
  config panels, Nagios-era density with no ranking. Density without hierarchy is the failure mode.
- **Don't** build **consumer SaaS marketing bleed**: gradients, spot illustrations, friendly
  empty-state mascots, or hero-metric tiles with sparkle. This is an internal instrument, not a
  product tour.
- **Don't** put Signal Live or Signal Cut on a button, a link, a heading, or a non-status border.
  Red belongs on a `DEAD LETTERED` stamp, never on the card that contains it.
- **Don't** nest a panel inside a panel. Nested detail becomes an inset Surface Sunk region.
- **Don't** reach for a modal. Broadcast detail, Delivery detail, and Endpoint editing are all
  inline expansions, and every future detail view should be too.
- **Don't** write reassurance copy. No "Oops", no "Something went wrong", no exclamation marks.
- **Don't** animate layout properties, add bounce or elastic easing, or animate anything that is not
  a state change.
- **Don't** use `text-transform: uppercase` outside the Stamp role, and never in sentence-case
  labels, buttons, or tabs.
