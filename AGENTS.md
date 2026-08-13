# webhook-broadcast

## Agent skills

### Issue tracker

Issues live as GitHub issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Design context

`PRODUCT.md` (strategic: register, users, brand personality, anti-references, design principles) and
`DESIGN.md` (visual: colors, typography, elevation, components) at the repo root. Read both before
any work on `apps/web`. `PRODUCT.md` binds the UI to `CONTEXT.md`'s vocabulary: Channel, Endpoint,
Broadcast, Replay, Delivery, Attempt. Never "event", "message", "job", "subscriber".

`apps/web` styles itself with hand-written CSS in `apps/web/src/styles.css` and takes no pre-styled
component kit (shadcn/ui, MUI, Mantine) and no utility-CSS framework (Tailwind). Read
`docs/adr/0013-headless-overlay-primitives-not-a-component-kit.md` and
`docs/adr/0014-tailwind-not-adopted-at-current-scale.md` before adding any UI or styling dependency.
0013 is settled; 0014 is a scale judgment with stated conditions for reopening, so propose rather
than assume. A surface that genuinely needs to float above content takes the headless `radix-ui`
primitive for its behavior only, dressed in the existing classes; see `DESIGN.md` §5 Overlays for
the terms.
