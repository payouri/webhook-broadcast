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
