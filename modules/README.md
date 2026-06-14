# `modules/` — FROZEN (incomplete modular-monolith migration)

> **Do not treat this tree as current code.** Source of truth is `lib/` + `app/`.

## Status

This was the Fase 0/1 scaffold of a planned "monolito modular" refactor
(commits `be71229`, `5c4261a`). The migration was paused while feature work —
including the SQLite→PostgreSQL migration (`c16c3a3`) and subsequent fixes —
continued in `lib/` and `app/(app)/**/actions.ts`.

The stale per-module copies were removed on 2026-06-14. This tree now keeps only
the live registry/manifest surface used by navigation, permission parity tests
and seed/bootstrap checks.

## What is actually live here

- `modules/registry.ts` + each `modules/<área>/manifest.ts`: drive navigation (`components/layout/nav-items.ts`), permission parity checks, and seed/bootstrap validation. **Edit these only for nav/permissions/seed.**
- `modules/permissions.ts`: compatibility helpers for tests/audit derived from the registry.
- `modules/manifest-types.ts`: the minimal contract shared by manifests and registry.

## Resuming the migration (finding A1 in the audit)

The decided direction is to **complete** the migration, but only after reconciling the divergence so `lib/` stays the single source of truth:

1. Freeze divergence (done — this notice + the note in `AGENTS.md`).
2. Remove stale copies instead of keeping misleading shims (done on 2026-06-14).
3. If the migration resumes, regenerate module implementations from `lib/` and
   `app/`, never the reverse, with contract tests against the current flows.
4. Wire `app/` → `modules/` one route at a time only after the regenerated module
   is proven equivalent.

Full context: `.claude/plans/shiny-scribbling-lynx.md`.
