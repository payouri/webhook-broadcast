# Dashboard screen inventory (from prototype C)

Source: throwaway prototype on branch `prototype/dashboard-ia` (`prototypes/dashboard-ia/`), Variant C — Channel navigator with shadcn + TanStack Query. Confirmed 2026-08-10.

## IA decisions

- **Landing:** Channel directory — answers “which Channels exist and are they healthy?” in the first two seconds.
- **History row:** Broadcast (Channel-scoped). Delivery is nested under Broadcast; Attempt under Delivery.
- **No global Delivery triage** — operator always works inside a Channel.
- **Freshness:** TanStack Query `refetchInterval: 5s` on Channel list, Channel activity, and Broadcast Deliveries.
- **Pagination:** cursor/keyset on Channel activity (`receivedAt`, `id`) — infinite scroll shape; not offset pages.
- **Actions:** Replay Broadcast (while retained); Retry Delivery when `dead_lettered`. Auto-disabled Endpoints shown on Endpoints tab.

## Screens & data required

| Screen | Shows | Data / API needs |
|---|---|---|
| **Channel list** (home) | slug, enabled, description, endpoint count | `GET /channels` |
| **Channel → activity** | Broadcast rows: receivedAt, body preview, fan-out summary (succeeded/dead/pending/total) | `GET /channels/:id/broadcasts?cursor=` |
| **Channel → endpoints** | name, url, enabled, autoDisabledAt, successRate24h, p95Ms, lastSuccessAt | `GET /channels/:id/endpoints` (+ health aggregates) |
| **Channel → settings** | slug, description, enabled, ingest tokens (masked) | `GET/PATCH /channels/:id` |
| **Broadcast detail** | inbound body + contentType + receivedAt; fan-out Deliveries; Replay | `GET /broadcasts/:id`, `POST /broadcasts/:id/replay` |
| **Delivery detail** | endpoint identity, status, Attempt timeline; Retry if dead_lettered | `GET /deliveries/:id`, `GET /deliveries/:id/attempts`, `POST /deliveries/:id/retry` |
| **Endpoint create/edit** | url, name, timeoutMs, headers, enabled | `POST/PATCH /channels/:id/endpoints/:endpointId` |

## Empty / loading / error

- Channel list / activity / endpoints: skeleton or “Loading…”, empty dashed state, inline error with retry via Query.
- Broadcast/Delivery not found: destructive inline message + back link.

## Out of this inventory

- Cross-channel Delivery ops console (Variant A) — rejected.
- Global Broadcast inbox (Variant B) — rejected as landing; Broadcast remains the activity row *inside* a Channel.
