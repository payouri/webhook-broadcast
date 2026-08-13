# Product

## Register

product

## Users

A small engineering team (single tenant, a handful of operators) running routine ops checks on
their own webhook infrastructure. They open the dashboard on a desktop browser during the working
day, usually proactively: "is anything wrong with our fan-out?" Sometimes reactively: "this
integration didn't receive its payload, where did it break?"

Their jobs to be done, in order of frequency:

1. Confirm at a glance that Channels are healthy and nothing is dead-lettering.
2. Trace a specific failure from Channel to Broadcast to Delivery to the Attempt error string.
3. Configure: create Channels, add and edit Endpoints, rotate ingest and operator tokens.
4. Recover: Replay a retained Broadcast, retry a dead-lettered Delivery, re-enable an
   auto-disabled Endpoint.

They read HTTP fluently. Status codes, timeouts, retry semantics, and raw request bodies are
comfortable primitives, not things to hide behind friendly abstractions.

## Product Purpose

webhook-broadcast is a single-tenant webhook multiplexer: an inbound request on a named Channel is
fanned out to every subscribed Endpoint, and every Delivery is recorded.

The dashboard is the only human surface over that machinery. It exists so an operator can answer
three questions without reaching for `psql` or the worker logs:

- Is the fan-out working right now?
- If something failed, exactly what failed and why?
- Can I fix it from here?

Success looks like: an operator's routine check takes seconds, and a real failure takes one
navigation path (not a search) to reach the underlying HTTP error.

## Brand Personality

**Precise, calm, operator-grade.**

Voice: technical peer, not assistant. States what happened, in the domain's own words, and stops.
No reassurance, no exclamation, no apology copy. An error message names the endpoint, the status
code, and the attempt; it does not say "Oops, something went wrong."

Emotional goal: confidence under pressure. When the operator arrives because something broke, the
interface should feel like an instrument that is telling them the truth, not a system that is
panicking with them.

Reference feel (personality, not palette):

- **Grafana / Datadog** for monitoring instincts: health legible at a glance, density built for
  scanning rather than reading, state visible before detail is requested.
- **Linear** for restraint and speed: opinionated defaults, minimal chrome, motion that is nearly
  absent and never decorative.
- **Vercel / Railway** for developer-infra plainness: log-like and row-like structures, monospace
  where the content is genuinely machine-shaped (URLs, bodies, headers, token prefixes).

## Anti-references

- **Enterprise monitoring dread.** Walls of red gauges, undifferentiated dense config panels,
  Nagios/Jenkins-era information density with no hierarchy. Density is a goal; density without
  ranking is the failure mode being avoided.
- **Consumer SaaS marketing bleed.** Gradients, spot illustrations, friendly empty-state mascots,
  hero-metric tiles with sparkle. This is an internal instrument, not a product tour.

## Design Principles

1. **Health before detail.** Every screen answers "is anything broken here?" before it presents
   anything else. Detail is available on demand; state is never something you have to go find.

2. **The domain language is the interface language.** `CONTEXT.md` is binding, in the UI as much as
   in the code: Channel, Endpoint, Broadcast, Replay, Delivery, Attempt. Never "event", "message",
   "job", "topic", "subscriber", "target". A vocabulary the operator already shares with the
   codebase costs zero translation.

3. **Scanning beats reading.** The routine check is a glance across many rows, not a study of one.
   Rows should be comparable down a column: aligned, predictable, differing only where they
   genuinely differ.

4. **Failure is information, not alarm.** A dead-lettered Delivery is a fact to be located
   precisely, not an emergency to be dramatized. Failure states get clarity and prominence, never
   volume.

5. **One path from symptom to cause.** The route from "a Channel looks wrong" to "this Attempt
   returned 503 after 4.2s" is a single continuous drill-down, not a search across screens. Nothing
   on that path should require the operator to hold state in their head.

6. **The instrument never twitches.** Movement on this surface means something changed in the
   fan-out. A representation of waiting that appears and vanishes inside a blink means nothing, and
   an operator scanning for instability cannot tell the difference between a flickering dashboard and
   a flickering system. So a loading state is earned, never reflexive: it waits to see whether the
   work is actually slow, and once shown it stays long enough to be read. Fast work resolves into
   changed content with no intermediate state at all.

## Accessibility & Inclusion

- **Status is never encoded in color alone.** Delivery status (`pending`, `in_progress`,
  `succeeded`, `failed`, `dead_lettered`), Channel and Endpoint enabled state, and Attempt outcomes
  must each carry a text label or a distinct non-color form. Color is reinforcement, never the
  signal. This is a hard requirement, not a preference: color vision deficiency is common in
  engineering teams and this interface's entire job is communicating state.

No further formal accessibility target has been set. WCAG 2.2 AA contrast, full keyboard
operability, and `prefers-reduced-motion` support were considered and not adopted as requirements;
treat them as sensible defaults to follow where they cost nothing, not as constraints to design
around.
