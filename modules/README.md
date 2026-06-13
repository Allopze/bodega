# `modules/` — FROZEN (incomplete modular-monolith migration)

> **Do not treat this tree as current code.** Source of truth is `lib/` + `app/`.

## Status

This is the Fase 0/1 scaffold of a planned "monolito modular" refactor (commits `be71229`, `5c4261a`). The migration was paused while feature work — including the SQLite→PostgreSQL migration (`c16c3a3`) and subsequent fixes — continued in `lib/` and `app/(app)/**/actions.ts`.

As a result, the per-module copies here have **diverged** from the live code:

| Frozen copy | Live source of truth | Approx. drift |
|---|---|---|
| `modules/requests/services/item-state.ts` | `lib/services/item-state.ts` | ~689 lines |
| `modules/purchasing/services/purchasing.ts` | `lib/services/purchasing.ts` | ~367 lines |
| `modules/warehouse/services/stock.ts` | `lib/services/stock.ts` | ~143 lines |
| `modules/*/actions/*`, `modules/*/{schema,validation}.ts` | `app/(app)/**/actions.ts`, `lib/validation/*` | not wired into `app/` |

`app/` imports **none** of these except `modules/registry.ts`.

## What is actually live here

- `modules/registry.ts` + each `modules/<área>/manifest.ts`: drive navigation (`components/layout/nav-items.ts`), the derived `Permission` type, and the seed. **Edit these only for nav/permissions/seed.**
- Everything else (`services/`, `actions/`, `schema.ts`, `validation.ts`) is **dead and stale** — do not import or copy from it.

## Resuming the migration (finding A1 in the audit)

The decided direction is to **complete** the migration, but only after reconciling the divergence so `lib/` stays the single source of truth:

1. Freeze divergence (done — this notice + the note in `AGENTS.md`).
2. Per module: replace the diverged `modules/*/services` copies with shims that re-export from `lib/services` (or regenerate them from `lib/`, never the reverse). Prove parity with a contract test against the existing pglite integration tests.
3. Wire `app/` → `modules/` one route at a time, with `eslint-plugin-boundaries` enforcing the boundary, then delete the `lib/` duplicate for that area.
4. Replace `core/` with real shims to the existing `lib/` primitives (`id`, `logger`, `audit`, `notifications`, `email`, `utils`) or delete it.

Full context: `.claude/plans/shiny-scribbling-lynx.md`.
