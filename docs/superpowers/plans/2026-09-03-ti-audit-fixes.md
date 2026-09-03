# TI Audit Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los hallazgos de seguridad, integridad, UX, accesibilidad y cobertura identificados en la auditoría del módulo TI.

**Architecture:** Mantener la lógica de negocio en `lib/services/ti` y `app/(app)/ti`, pasando explícitamente el scope por faena desde las server actions y páginas. Los flujos terminales seguirán teniendo servicios dedicados; los cambios de UI reutilizarán primitivas existentes y quedarán protegidos por pruebas de regresión.

**Tech Stack:** Next.js, React, TypeScript, Drizzle/PostgreSQL, PGlite/Vitest, Playwright, React Doctor.

**Spec:** `qa/reports/latest.md` (hallazgos TI-01 a TI-15 y deuda UI documentada).

## Global Constraints

- No modificar ni revertir cambios ajenos ya presentes en el árbol de trabajo.
- No confiar en la visibilidad de la UI como autorización; toda mutación y descarga debe verificar scope en servidor.
- La fuente de negocio permanece en `lib/` + `app/`; no recrear servicios en `modules/`.
- Las fechas civiles se interpretan en `America/Santiago`.
- Las migraciones se generan desde el schema con `npm run db:generate`; no editar el journal manualmente.
- Las exportaciones siguen siendo `.xlsx`.

---

### Task 1: Scope por faena y protección de recursos TI

**Files:**
- Modify: `app/(app)/ti/activos/actions.ts`, `app/(app)/ti/activos/page.tsx`, `app/(app)/ti/activos/[id]/page.tsx`
- Modify: `lib/services/ti/assets.ts`, `lib/services/ti/access.ts`, `lib/services/ti/licenses.ts`
- Modify: `app/(app)/ti/accesos/page.tsx`, `app/(app)/ti/licencias/page.tsx`, sus actions
- Modify: `app/(app)/ti/reportes/actions.ts`
- Modify: `app/api/ti/attachments/[id]/route.ts`
- Test: `lib/__tests__/ti-authorization-scope.test.ts`

**Interfaces:**
- Services accept `worksiteIds: string[] | "all"` as the final authorization argument where the target has a faena.
- Global sessions retain unrestricted behavior; scoped sessions with no faenas see/mutate nothing.
- Attachment access resolves the owning TI entity before reading the filesystem.

- [ ] Add failing tests for cross-faena asset mutation, report history export, attachment download, licenses and access reads/mutations.
- [ ] Thread `serviceWorksiteScope(session)` through pages/actions/services and enforce target ownership before every mutation.
- [ ] Apply the same scope to worker, asset, worksite and checklist selector queries.
- [ ] Resolve attachment ownership through the supported TI entity relationships before serving files.
- [ ] Run the focused authorization test and the existing TI suites.

### Task 2: Asset state machine, custody and license/access integrity

**Files:**
- Modify: `lib/validation/ti.ts`, `lib/services/ti/assets.ts`, `lib/services/ti/retirements.ts`
- Modify: `lib/services/ti/licenses.ts`, `lib/services/ti/access.ts`
- Modify: `lib/services/ti/queries.ts`
- Test: `lib/__tests__/ti-assets-pglite.test.ts`, `ti-maintenance-retirement-pglite.test.ts`, `ti-licenses-access-pglite.test.ts`

- [ ] Add failing tests for terminal status bypass, open custody on loss/theft, invalid license target/capacity, access reactivation and checklist reopening.
- [ ] Restrict manual status transitions to `MANUAL_ASSET_STATUSES` and preserve formal retirement flow.
- [ ] Define loss/theft custody closure so active-custody KPIs do not count a non-returnable asset.
- [ ] Validate active worker/asset and matching worksite for license assignments; prevent purchased quantity below active assignments.
- [ ] Clear revoked timestamps on reactivation, preserve notes unless explicitly changed, and synchronize checklist `completedAt`.
- [ ] Run affected PGlite suites.

### Task 3: Tickets, photos and civil dates

**Files:**
- Modify: `lib/services/ti/tickets.ts`, `app/(app)/ti/tickets/actions.ts`, ticket UI
- Modify: `lib/services/ti/assignment-photos.ts`, photo sheets/routes
- Create/Modify: shared TI civil-date helper and consumers in assets, guarantees and alerts
- Test: `lib/__tests__/ti-tickets-pglite.test.ts`, `ti-alerts-pglite.test.ts`, new photo/date regressions

- [ ] Add failing tests for clearing resolution on reopen, preserving assignee on status-only transitions, pending return-photo retention and Chile date boundaries.
- [ ] Separate assignee changes from status transitions and clear stale resolution metadata when reopening.
- [ ] Exclude pending return photos from orphan cleanup until submitted or explicitly abandoned.
- [ ] Use a single Chile civil-date comparison for UI and service alerts.
- [ ] Run focused tests and verify no changed API loses error feedback.

### Task 4: TI UX, responsive actions, accessibility and visual consistency

**Files:**
- Modify: TI sheets, tables, empty states, access matrix, charts and print page identified in `qa/reports/latest.md`.
- Test: relevant component tests and `e2e/ti-modulo.spec.ts`.

- [ ] Add accessible button semantics to clickable sheet triggers.
- [ ] Keep return/transfer actions available on mobile assignment cards.
- [ ] Connect access filters to visible controls or the shell search contract.
- [ ] Replace plain empty paragraphs with `EmptyState` and real CTAs.
- [ ] Fix safe HTTP parsing, object URL cleanup, native date controls, zero-cost chart behavior and duplicate print toolbar.
- [ ] Run React Doctor on changed files and the TI E2E smoke.

### Task 5: Database uniqueness and regression coverage

**Files:**
- Modify: `db/schema/ti.ts`
- Create: generated migration under `db/migrations/`
- Modify: relevant TI tests and `qa/reports/latest.md`

- [ ] Add a unique constraint/index for access-system names after checking duplicate data handling.
- [ ] Generate the migration with `npm run db:generate` and confirm a second generation reports no schema changes.
- [ ] Add regression coverage for system-id matrix resolution and all high-risk scope boundaries.
- [ ] Run all TI tests, typecheck, lint, build where feasible, E2E and changed-scope React Doctor.

### Task 6: Final audit and handoff

- [ ] Inspect `git diff` and ensure unrelated existing changes remain untouched.
- [ ] Read the final QA report and update findings with actual verification evidence.
- [ ] Report remaining environmental gaps, if any, without treating them as product passes.
