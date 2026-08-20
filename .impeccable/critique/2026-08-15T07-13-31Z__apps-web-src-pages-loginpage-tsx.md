---
target: "the login screen (issue #85)"
total_score: 20
p0_count: 0
p1_count: 3
timestamp: 2026-08-15T07-13-31Z
slug: apps-web-src-pages-loginpage-tsx
---

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                                                                                                                                                  |
| --------- | ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 2         | `useDelayedPending` drives the _label_ correctly (measured 259ms against a 250ms spec) but `disabled` is bound to the raw `submitting` flag, dimming the primary control for 13ms on the fast path                         |
| 2         | Match System / Real World       | 3         | Server strings echo verbatim: `invalid operator API key`, `too many login attempts`. Lowercase, no subject, no terminal period, against a DESIGN.md exemplar that is a full sentence                                       |
| 3         | User Control and Freedom        | 2         | Rate-limited is a state with no stated exit. No reveal on a field holding an API key. No cancel on an in-flight submit                                                                                                     |
| 4         | Consistency and Standards       | 1         | Three verbs for two actions (title "Log in", button "Sign in", header "Log out"). Error markup diverges from all five sibling forms. Disabling submit for invalidity contradicts the Reward-Early-Punish-Late Rule by name |
| 5         | Error Prevention                | 1         | Principle 7 inverted: `loginRequestSchema` is never imported, its `.min(1)` is hand-restated as `apiKey.length === 0` inside a `disabled` attribute. Nothing prevents attempt six                                          |
| 6         | Recognition Rather Than Recall  | 2         | Masked field with no reveal: a pasted key cannot be verified before spending one of five attempts. After lockout the operator must recall when they started                                                                |
| 7         | Flexibility and Efficiency      | 3         | `autoFocus`, Enter-to-submit, correct tab order, visible focus rings, value retained after a 401. Genuinely complete keyboard operation                                                                                    |
| 8         | Aesthetic and Minimalist Design | 3         | Materially excellent, but the default first-paint state is a primary control whose label sits at 2.02:1 against its own fill                                                                                               |
| 9         | Error Recovery                  | 1         | 401 and 429 are pixel-identical apart from the sentence. No `Retry-After` (confirmed absent), no countdown, no guidance, button stays enabled                                                                              |
| 10        | Help and Documentation          | 2         | One hint line, and it is a dev-machine line naming an env var, shipped to whatever environment this runs in                                                                                                                |
| **Total** |                                 | **20/40** | **Acceptable (bottom edge)**                                                                                                                                                                                               |

For reference, the dashboard as a whole scored 27/40 on 2026-08-14. Login is the weakest surface in the app, which is exactly what three critiques skipping it would predict.

## Anti-Patterns Verdict

**LLM assessment: not slop, but it stops one layer short of being an instrument.**

Every shared ban is clean: no side-stripe borders, no gradient text, no glassmorphism, no hero-metric template, no card grid, no modal. The card is a real `.plate` from The Faceplate system with the hue-195 graphite neutrals, the 3px plate radius, the `inset 0 1px 0 var(--lip-light)` machined lip, Anodized Cyan on the primary, an Engraved-role field label, and a genuine light+dark pair that was exercised from the toggle on the screen itself. `.login-card` carries a comment explaining that its rhythm comes from `.field-stack` like every other form. That is system membership, not pastiche. `<Radio>` as the brand mark is semantic (fan-out), not decoration.

Where it is the reflex: a 400px centred card on an empty page is the single most template-like login composition that exists, and at 2560px it is a 400x293 rectangle marooned in 2.7 million pixels saying nothing about _which instance_ the operator is about to log into. And the register slips at the exact moments that separate a system from a template. The error is a bare sentence with no glyph, while `EndpointForm.tsx:263`, `ChannelSettingsForm.tsx:144` and `InlineLoadError.tsx` all render a `TriangleAlert` inside `.error-text`. Nobody says "AI made this" on sight. A design director says "this was built before the system existed and never came back."

**Deterministic scan**: `detect.mjs` on `apps/web/src/pages/LoginPage.tsx` exits **0, zero findings**. Widened to `apps/web/src`: exit 2, 41 files scanned, 19 findings, all `warn`, zero `ban` (em-dash 15, pure-black-white 2, generic-sans-font 1, layout-animation 1). **The login-screen intersection is zero.** No finding cites `LoginPage.tsx`, `ThemeToggle.tsx`, `delayedPending.ts` or `App.tsx`. The only one it inherits is `generic-sans-font` at `styles.css:207`, which is the deliberate system stack.

Two of the three CSS findings are false positives: `pure-black-white` at `styles.css:12` cites the header comment _stating_ the no-hex rule (independently confirmed, 47 `oklch()` declarations and zero hex in the file), and `layout-animation` at `styles.css:991` is `transition: left` on an absolutely positioned switch plunger, which the login screen does not contain. Of the 15 em-dashes, most are in code comments rather than shipped copy; `ChannelSettingsForm.tsx:33` and `BroadcastDetailPanel.tsx:175` are real user-facing strings, and none are on this screen.

The useful signal is the null result itself: **a clean deterministic scan on a surface that scores 20/40.** Every defect here is behavioral or semantic, and the detector is structurally blind to all of them.

**Visual overlays**: not injected. The `chrome-devtools` MCP server is not run with `--isolated`, so only one agent can hold the browser profile, and it was assigned to the design review, which used it for direct instrumented inspection instead. No user-visible overlay is available. The fallback signal is the live evidence log below: eight states observed running, with computed contrast, MutationObserver timing, network headers, and measured layout deltas.

## Overall Impression

The login screen is not unstyled, it is unmaintained. It received the field system in #62 and then the app moved on without it: #71 gave the New Endpoint form per-field contract validation, #86 gave it to Channel Settings, #77 put control pending states on the shared delay-and-hold hook. Login got none of those, and it is the one form where the failure path is not an edge case but the whole point.

The material work is real and holds up under measurement. Every text color clears AA in both themes. The keyboard path is complete. `useDelayedPending` is wired correctly and was measured obeying the 250ms/400ms spec exactly.

The single biggest opportunity is the **rate-limited path**, because it is where three separate failures compound into one bad moment. The server knows `resetAt` and sends nothing. The client renders the 429 identically to the 401. The button stays enabled and invites attempt seven. An operator paged at 03:00 who fumbles their key twice ends up staring at four lowercase words while a Delivery is dead-lettering, and PRODUCT.md's stated emotional goal for that exact moment is "an instrument telling them the truth."

## What's Working

1. **The No-Flicker Rule is genuinely implemented here, and that is rare in this repo.** Measured under a 2500ms injected fetch delay: `Sign in` at t+0, `Signing in…` at **t+259ms** against a 250ms spec, held past the response. On the natural 13ms round trip the pending label **never painted at all**. That is the rule working exactly as written, on a surface where the standing repo defect has been the opposite.

2. **The color work is load-bearing, not decorative, and it survives measurement.** Light theme: prose 5.84, label 5.84, h1 16.47, primary label-on-Anodize 5.72, error text 6.20. Dark: 5.43, 5.43, 13.19, 6.93, 5.65, focus ring 5.88. Every value computed OKLCH to sRGB to WCAG relative luminance, not eyeballed. And `.field-control:focus` puts the Anodize ring _inset_ 2px so the well never resizes on focus.

3. **Keyboard operation is complete and unglamorous, which is the point.** `autoFocus` lands in the field, Shift+Tab reaches the theme toggle with a visible ring, Tab reaches submit, Enter submits. The field retains its value after a 401, so a mistyped character costs one keystroke rather than a full re-entry. A returning operator goes from page load to authenticated without touching the mouse.

## Priority Issues

### [P1] The rate-limited operator is told they are stuck and nothing else

`too many login attempts` is the entire message, rendered in the same `.error-text`, same position, same color, same absence of a glyph as `invalid operator API key`. Verified live: five 401s then a 429 on the sixth, and the 429 response carries **no `Retry-After`** (full header list captured). The submit button stays enabled. The operator cannot distinguish a fat-fingered key from a 60-second lockout except by reading prose, and cannot learn the window at all.

Worse, the limiter is in-memory and keyed on `ctx.ip` (`apps/api/src/admin/loginRateLimit.ts:21`). On a shared egress IP, five wrong attempts by one operator lock out the whole team, and nothing anywhere says so. A second operator types the correct key first try and receives a message describing something they did not do.

**Why it matters**: this is the surface at the operator's worst moment, and it is where the screen abandons them hardest. The mental model becomes "the login is broken" rather than "I am in a cooldown."

**Fix**: return `Retry-After` and the reset epoch on the 429 (the limiter already holds `resetAt`, it just never leaves the process). Render a distinct treatment with a live countdown, and disable submit for exactly that window. This is the one legitimate reason to disable it, because it is a genuine server-side prohibition rather than an invalidity judgement. State the per-IP consequence in an advisory well, not the error.

**Suggested command**: `/impeccable harden`

### [P1] The login form is the only form in the app that does not mark its own field

Both assessments landed on this independently. `LoginPage.tsx:66-70` renders `<p className="error-text" role="alert">{error}</p>`: no `id`, no glyph, no `aria-invalid` on `#apiKey`, no `aria-describedby`. Live-verified after a 401: both attributes read `null`. Five sibling forms (`EndpointForm.tsx:259-263`, `ChannelSettingsForm.tsx:140-144`, `ChannelDirectoryPage.tsx:188-208`) wire all four.

The consequence is not cosmetic: `styles.css:906` defines `.field-control[aria-invalid="true"] { border-color: var(--lamp-cut); }` and it **can never match on this screen**, so the one non-color-independent marker the system has for a broken field never renders. A screen-reader user gets a bare alert with no relationship to the field, then tabs back to an input that reports itself as perfectly valid.

Also worth noting: `role="alert"` sits on a conditionally-mounted element, so the announcement depends on the AT noticing the region's insertion rather than a text change inside an existing region, which is inconsistent across screen readers.

**Fix**: add `id="apiKey-error"`, `aria-invalid={error ? "true" : "false"}`, `aria-describedby={error ? "apiKey-error" : undefined}`, and the `TriangleAlert size={13}` the other forms use. Five lines, and this form becomes identical to `EndpointForm`.

**Suggested command**: `/impeccable harden`

### [P1] The primary action is unreadable in the screen's default state

`disabled={submitting || apiKey.length === 0}` ships the button disabled at first paint. `.control:disabled` applies `opacity: 0.45`, and the composited label-on-fill measures **2.02:1 in light and 2.44:1 in dark**. The opening image of the only surface gating the entire console is a ghost.

It is also a named-rule violation. DESIGN.md's Reward-Early-Punish-Late Rule states that the submit control is not disabled to express invalidity, and disables only while a request is genuinely in flight. And the constraint being expressed is `loginRequestSchema`'s own `apiKey: z.string().min(1)` (`packages/contract/src/auth.ts:3-5`), hand-restated as `.length === 0` rather than read from the schema. `apps/web/src/lib/useFieldError.ts:24-26` documents that exact anti-pattern in this repo's own words, and `LoginPage.tsx` imports neither the schema nor the hook.

**Why it matters**: hierarchy is inverted for 100% of first arrivals. The h1 is the loudest thing on screen at 13.19:1 and the primary action is the quietest at 2.02:1.

**Fix**: drop `apiKey.length === 0` from `disabled`, keep `submitting`. Import `loginRequestSchema`, run it in `handleSubmit`, and on failure render a field-level message with `aria-invalid`. No round trip, message at the field, control alive.

**Suggested command**: `/impeccable harden`

### [P2] The card twitches on every failed attempt

Mounting `.error-text` grows the card by 31px, and because `.centered` uses `align-items: center` the whole plate jumps **15.5px upward** (measured: top 318.75 to 303.25) while the submit button moves 13px down. `setError(null)` at the top of the next `handleSubmit` then unmounts it, dropping the card back, and the response remounts it. Under repeated failure, which is the rate-limit path by definition, the card bounces once per attempt and Sign in walks out from under the cursor.

Separately, `submitting` flips `disabled` at t+0 with no delay, dimming the primary for 13ms on the fast path. This is the one place the two assessments disagreed: the static pass read the raw-flag binding as correct on the reasoning that disabling is not a representation of waiting, and the live pass measured the resulting 13ms twitch. The live reading wins, because Principle 6 is about movement on the surface, not about the taxonomy of the state driving it.

**Fix**: reserve the error row's height so mounting a message does not move the plate. Stop clearing `error` on submit; replace it when the new outcome arrives. Pass `submitting` through `useDelayedPending` for the `disabled` binding too, so one hook output drives both.

**Suggested command**: `/impeccable animate`

### [P2] `type="password"` with `autoComplete="current-password"` and no username, on a shared API key

Chrome flags this itself, unprompted, on page load: `[DOM] Password forms should have (optionally hidden) username fields for accessibility`. The field holds `OPERATOR_API_KEY`, a single shared bootstrap secret, not a per-person password. With no username field, password managers file it under an empty identity, so on a single-tenant deploy every operator's manager offers to save the same shared secret as their personal localhost password. There is no reveal control, so an operator pasting a 40-character key cannot verify it before spending one of five attempts. No `spellCheck`, `autoCapitalize` or `autoCorrect` are set anywhere.

**Fix**: keep `type="password"` for masking, set `autoComplete="off"` so this is not filed as a login credential, and add a reveal toggle on the field's trailing edge.

**Suggested command**: `/impeccable harden`

### [P2] A long error string overflows the card

The static pass caught what the live pass could not reach: `.error-text` (`styles.css:1600-1607`) declares no `overflow-wrap` or `word-break`, and the file's wrapping rules at `:1574`, `:1839`, `:1879` and `:2240` do not apply to it. Inside a card pinned to `width: min(400px, 100%)`, an error containing a long unbroken token will overflow horizontally rather than wrap. `describeApiError` (`apps/web/src/lib/api.ts:110-118`) returns the server's `message` verbatim for allowlisted codes, so this is reachable rather than theoretical.

**Fix**: add `overflow-wrap: anywhere` to `.error-text`. One line, and it protects every form in the app, not just this one.

**Suggested command**: `/impeccable adapt`

## Persona Red Flags

**Jordan (First-Timer)**: arrives at a card whose only action is a 2.02:1 ghost, and whose only guidance is `Find your key in the OPERATOR_API_KEY environment variable.` Jordan has no shell on the API host, so that sentence points at a place they cannot reach and names a thing they may confuse with the operator tokens that Settings lets them mint, which `authRoutes.ts:22` explicitly refuses to accept here. Nothing says "ask whoever deployed this." Five wrong guesses later they get `too many login attempts` and cannot tell whether it is permanent.

**Sam (Accessibility-Dependent)**: after a 401, `#apiKey` carries `aria-invalid: null` and `aria-describedby: null`, both measured. The screen reader announces the alert sentence once, then Sam tabs back to a field that reports itself as valid and describes itself only as "Operator API key, required." The Lamp Cut border never renders. The single `<main>` is the only landmark and the `<form>` has no accessible name.

**Riley (Stress Tester)**: finds the seam in ten seconds. Attempts 1 to 5 return 401, attempt 6 returns 429, the button stays enabled throughout. Riley also discovers that hammering past the lock does not extend it, because `tryConsume` returns false without incrementing. The interface gives no signal either way, so the honest operator assumes hammering makes it worse and stops, while the attacker learns the truth immediately.

**The On-Call Operator at 03:00** (PRODUCT.md job 2, the reactive path): paged because an integration did not receive its payload. Fumbles the key from a password manager twice under stress, gets locked out, and stares at four lowercase words on a card that bounces 15.5px on every attempt while a Delivery is dead-lettering.

**The Second Operator on the shared office IP**: their colleague burned all five attempts. They type the correct key on their first try and receive a message describing something they did not do, about a limiter they cannot see, for a duration nobody states. There is no path from that string to the truth.

## Minor Observations

- **`OPERATOR_API_KEY` is set in the body sans, not mono.** The Machine Voice Rule reserves monospace for machine-authored, character-exact strings. An env var name is exactly that, and it is the one machine token on the screen.
- **Verb drift is three-way**: `document.title` "Log in", button "Sign in", header "Log out". DESIGN.md lists `Sign in` as a canonical primary label, so the title should read `Sign in · webhook-broadcast` and the header should say `Sign out`.
- **The hint has no production form.** Naming an internal config surface to anyone who reaches the URL is a dev sentence shipped everywhere. It is also a field advisory sitting in `.prose` above the field, and DESIGN.md has a well for exactly that.
- **`GET /auth/session` fires twice on boot**, both 401, from StrictMode double-invoke. Harmless, but two 401s in the console on every load is noise for anyone debugging auth.
- **Clicking the theme toggle steals focus from the auto-focused field** and nothing returns it.
- **The button resizes mid-submit** (`Sign in` to `Signing in…`, measured 105.8px while pending). Cosmetic, but a `min-width` would hold it still.
- **`prefers-reduced-motion` is a non-issue here, verified**: `document.getAnimations()` returns 0 on this screen in both themes.
- **Responsive behaviour is clean.** At 390px the card is 342px with `scrollWidth === innerWidth` and no clipping. At 2560px it holds at 400px with no stretch.
- **Test coverage of the failure path is zero.** `apps/web/test/App.test.tsx` covers the login form appearing, a successful login, and logout. There is no `LoginPage.test.tsx`, and nothing covers `setError`/`describeApiError`, the error element, any a11y wiring, the disabled gating, or the delayed pending label on this screen.
- **The 400 `validation_failed` path is unreachable from the UI**, and its message carries no `details` array, so if it were ever reached it would render as exactly the field-less form-level string Principle 7 condemns.

## Questions to Consider

1. The limiter knows `resetAt` and the API knows the window is 60s. `authRoutes.ts` sends neither. Is withholding a countdown from someone who has already proven they cannot get in a threat model, or did nobody write the header?
2. If the limiter is per-IP, in-memory and single-process, is it a security control or a UX hazard? It survives no restart, protects against no distributed attempt, and its most reliable effect is locking out the honest operator behind the same NAT.
3. DESIGN.md says in plain language that the submit control is not disabled to express invalidity, and the login screen disables it for an empty field. Does anything in the repo currently catch a named rule being contradicted?
4. Every other form imports its constraint from `@webhook-broadcast/contract`. Login is the one form whose constraint is trivial enough to inline, and it is the one that inlines it. Is Principle 7 a rule, or a habit that holds only where validation is hard enough to be worth sharing?
5. This is the only surface a user sees before authentication, and it says nothing about which instance they are about to operate. On a team running staging and production behind identical URLs, should the login lockup carry the environment the way every other faceplate carries its legend?
6. `describeApiError` echoes the server's message verbatim for allowlisted codes. That is right for `slug already exists`. Is it right for `too many login attempts`, where the server sends a status report and the operator needs an instruction? Where should the allowlist stop?

## Reachability Recipe

Verified and non-destructive. Do not click "Log out"; it discards the session cookie for no benefit.

1. Open a new tab in an **isolated browser context**: `mcp__chrome-devtools__new_page` with `url: "http://localhost:5173/"` and `isolatedContext: "login-review"`. An isolated context has its own cookie jar, carries no session cookie, and `GET /auth/session` returns 401.
2. `App.tsx` sets `session === "loggedOut"` and renders `LoginPage` immediately.
3. Exercise all states there. The authenticated tab is untouched: different cookie jar, and the seeded data is server-side regardless.
4. `close_page` the isolated tab when done. Nothing to restore.

Caveats: the rate limiter is keyed on `ctx.ip`, not on browser context, so attempts burned in the isolated tab consume the shared 5-per-60s budget for the whole machine. Wait out the 60s window before further login work. If the MCP Chrome profile is held by an orphaned `--remote-debugging-pipe` process, read the PID from `~/.cache/chrome-devtools-mcp/chrome-profile/SingletonLock`, confirm its `--user-data-dir` is the MCP profile, kill it, and delete the `Singleton*` symlinks.

The authenticated tab was re-verified after all testing: title `Channels · webhook-broadcast`, 7 seeded Channel rows with live failing lamps. The session and data were never at risk and no re-login was needed.

## Live Evidence Log

All eight target states were observed running against `http://localhost:5173` in an isolated context. Config read from `.env`: `LOGIN_RATE_LIMIT_MAX_ATTEMPTS=5`, `LOGIN_RATE_LIMIT_WINDOW_MS=60000`.

- **At rest, light and dark**: observed. Theme toggle works before a session exists, stamping `data-theme` in both directions.
- **Focus and keyboard**: observed. Tab order toggle to field to submit, `2px solid oklch(0.48 0.115 195)` ring at `outline-offset: 2px`, Enter submits.
- **Disabled vs enabled submit**: observed. 2.02:1 light / 2.44:1 dark disabled, 5.72:1 enabled.
- **Pending**: observed via MutationObserver. 259ms to paint under an injected 2500ms delay, never painted on the natural 13ms round trip. A screenshot of the pending label could not be captured because screenshot round-trip latency exceeded the injected window twice; the mutation log is the evidence.
- **Invalid credentials (401)**: observed. Exact string `invalid operator API key`. Focus does not move, value retained, `aria-invalid` and `aria-describedby` both null, no glyph, card jumps 15.5px.
- **Rate limited (429)**: observed. Exact string `too many login attempts`. Body `{"error":{"code":"rate_limited","message":"too many login attempts"}}`. No `Retry-After` in the response headers. Button remained enabled and further submits were accepted.
- **Viewports**: observed at 390x844, 1440x900 and 2560x1100. No overflow at any width.
- **Additional**: observed. `getAnimations()` returns 0, Chrome's own password-form warning fires on load, landmarks return `["MAIN"]` only, headings return `["H1:webhook-broadcast"]`.
