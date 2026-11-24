<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:agent-operating-contract -->
# Agent Operating Contract — READ BEFORE CHANGING CODE

This repository is a production-oriented internal business platform. Agents are expected to investigate, implement, verify, and leave evidence.

A change is **NOT complete** merely because:

- TypeScript compiles.
- The code looks correct.
- A unit test passes.
- The agent believes the fix is correct.
- MonkeyTest prints a green flow summary.

For behavior visible through the web application, verify the result through the running application whenever the environment allows it.

## 1. Understand before editing

Before modifying code:

1. Inspect the relevant implementation.
2. Identify the real source of truth.
3. Search for existing components, utilities, hooks and patterns before creating new ones.
4. Inspect related tests.
5. Inspect relevant repository documentation.
6. For Next.js behavior, read the relevant documentation from `node_modules/next/dist/docs/` before relying on model knowledge.
7. Determine whether the change affects authentication, authorization, navigation, database schema, server actions, exports, shared UI, forms, filters/search, integrations or operational workflows.

Do not create parallel abstractions when an established platform pattern exists.

## 2. Evidence-first debugging

Never fix a reported bug solely from a guess.

Preferred workflow:

1. Reproduce the problem.
2. Collect evidence.
3. Identify the responsible code and underlying cause.
4. Implement the smallest correct fix.
5. Re-run the original reproduction.
6. Run relevant automated tests.
7. For web behavior, verify through Playwright/browser automation when possible.
8. Add or update a regression test when the defect is important enough to recur.

Never report **fixed** unless the original failure can no longer be reproduced, or clearly state why runtime verification was impossible.

## 3. Definition of Done

A code change is complete only when all applicable checks are satisfied:

- code builds/typechecks;
- relevant lint checks pass;
- relevant automated tests pass;
- database changes follow the migration rules in this file;
- UI follows the layout/search/density rules in this file;
- changed user journeys have been verified when the app can be run;
- important regressions have deterministic tests;
- no unexplained console/network errors were introduced;
- verification gaps are explicitly reported rather than silently treated as success.

For a UI-visible or workflow-visible change, browser verification is expected whenever the local/staging environment is available.

## 4. Final response after implementation

When finishing a non-trivial implementation, report concisely:

- what changed;
- key files changed;
- tests/checks executed;
- browser/audit verification executed, when applicable;
- relevant QA report path;
- any remaining risk, warning or coverage gap.

Do not claim broader verification than was actually performed.
<!-- END:agent-operating-contract -->

<!-- BEGIN:rule-priority -->
# Rule Priority

When instructions appear to conflict, use this priority:

1. Data integrity and security.
2. Authorization and privacy.
3. Correct business behavior.
4. Existing architecture and source-of-truth rules.
5. Accessibility.
6. Established platform UI patterns.
7. UX consistency.
8. Local implementation convenience.

Do not violate a higher-priority rule to satisfy a lower-priority one.
<!-- END:rule-priority -->

<!-- BEGIN:reuse-before-create -->
# Reuse Before Creating

Before creating any new component, hook, form abstraction, table, dialog, sheet, selector, date control, export helper, badge, empty state, loading state, server-action wrapper or validation helper, search the repository for an existing implementation.

Prefer extending an established shared primitive over introducing a competing local abstraction.

Especially inspect:

- `components/ui/`;
- `components/admin/`;
- `components/layout/`;
- `lib/hooks/`;
- `lib/utils`;
- `lib/validation/`;
- neighboring modules implementing equivalent workflows.

If a new abstraction is necessary, be able to explain why the existing primitive cannot support the requirement.
<!-- END:reuse-before-create -->


<!-- BEGIN:export-rule -->
# Export Format Rule

All data exports in this app must use **Excel** format. Never use CSV for exports. Use a library like `xlsx` or `exceljs` to generate proper `.xlsx` files with formatting support.
<!-- END:export-rule -->

<!-- BEGIN:source-of-truth -->
# Source of truth: `lib/` + `app/`, NOT frozen module scaffolding

The live business logic is in `lib/services`, `lib/auth`, `lib/validation` and the per-feature `app/(app)/<área>/actions.ts`. The old **frozen, incomplete** "monolito modular" migration (Fase 0/1) was pruned on 2026-06-14: `core/` was removed and `modules/` now keeps only the live registry/manifest surface for navigation, permission parity checks and seed/bootstrap validation.

Rules until the migration is properly resumed:

- Make every business-logic change in `lib/` + `app/`.
- `modules/registry.ts`, `modules/permissions.ts`, `modules/manifest-types.ts` and the `modules/*/manifest.ts` files are the only live module-scaffolding parts; touch those only for nav/permissions/seed/bootstrap parity.
- Do not recreate `modules/*/{services,actions,schema,validation}` or `core/*` unless the modular migration is explicitly resumed with a reconciliation plan and parity tests.
- See `modules/README.md` for the reconciliation plan.
<!-- END:source-of-truth -->

# Faena de un equipo: sólo por traslado

La faena de un vehículo existente (`fuel_vehicles.worksite_id`) cambia ÚNICAMENTE con
`transferVehiclesTx` (`lib/services/fleet-transfers.ts`): cierra y abre la estadía, mueve las
asignaciones de proveedor y deja folio, motivo y auditoría. Un `UPDATE` directo (acción, importador
o script de una vez) falla por diseño al confirmar con `FLEET_STAY_INVARIANT`; las acciones lo
traducen con `isFleetStayInvariantError` a «Para cambiar de faena usa «Trasladar equipos».»
(`USE_TRANSFER_MESSAGE`). No agregues un camino que escriba la faena por su cuenta.

<!-- BEGIN:authorization-navigation -->
# Authorization and Navigation Parity

Any change that adds, removes, renames or materially changes a protected feature must check parity between:

- the application route;
- server-side authorization;
- navigation visibility;
- `modules/registry.ts`;
- `modules/permissions.ts`;
- relevant `modules/*/manifest.ts`;
- seed/bootstrap permissions when applicable.

Hiding an item from the sidebar is **not authorization**. Never rely on UI visibility as a security boundary.

When permission/navigation behavior changes across the application, prefer a full-scope assisted browser pass after targeted tests pass.
<!-- END:authorization-navigation -->

<!-- BEGIN:form-export-patterns -->
# Form, export and date formatting standards

## 1. Form Operation Pattern (`useOperation` & `Field`)

**Elige el hook por el mecanismo de envío, no por "es un formulario":**

| Caso | Hook | Por qué |
|------|------|---------|
| `<form action={serverAction}>` | `useActionState` | Es el idioma de React 19 y conserva la mejora progresiva (el form funciona sin JS). |
| Handler imperativo (`onClick`, confirmación en un `ConfirmDialog`, envío desde un `onChange`) | `useOperation` | No hay `<form>` que envíe; el hook aporta `pending` + `message` sin cablear `useTransition` a mano. |

- `useOperation` viene de `@/lib/hooks/use-operation` y expone `{ pending, message, setMessage, run }`.
- No conviertas un `<form action={...}>` a `useOperation`: pierde mejora progresiva y no gana nada.
- Al revés sí importa: si usas `useActionState` fuera de un `<form>` y descartas el resultado (`const [, action] = …`), los errores quedan invisibles para el usuario.
- ALWAYS use `Field` from `@/components/ui/field` for input wrappers (with accessible `Label`, `error`, `helper`/`hint` support). Never create local `form-kit.tsx` files or unaccessible `<label>` wrappers.
- Use `toLocalInputValue` from `@/lib/utils` for formatting local Date objects in `<input type="datetime-local">`.

## 2. Export Pattern (`ExportButton` & `ExportDialog`)
- Direct exports (Server Actions): Use `ExportButton` from `@/components/ui/export-button`.
- Filtered exports (Modal dialog): Use `ExportDialog` from `@/components/export-dialog`.
- Never duplicate base64 download logic or create standalone export buttons.

## 3. Date Formatting
- ALWAYS use `formatDate` or `formatDateTime` from `@/lib/utils`.
- NEVER use `toLocaleDateString()` directly in `.tsx` components to prevent locale mismatch inconsistencies across browsers.
- El día de HOY sale de `todayInChile()` y el año de `codeYear()` (`@/lib/utils`). `new Date().toISOString().slice(0,10)` y `new Date().getUTCFullYear()` miden en UTC: entre las 20:00 y la medianoche chilena contestan el día —y el 31 de diciembre, el año— siguiente. La regla `no-restricted-syntax` de `eslint.config.mjs` lo impide fuera de tests y `scripts/`. Sobre una fecha ya normalizada (`new Date(Date.UTC(...))`, un plain date) esos mismos métodos SÍ son correctos y no se marcan: lo prohibido es preguntarle a UTC qué día es hoy.
<!-- END:form-export-patterns -->

<!-- BEGIN:verification-commands -->
# Comandos de verificación

Este archivo se carga en toda sesión, así que las reglas por área viven junto al código que gobiernan y cargan sólo al entrar ahí:

| Regla | Archivo |
| --- | --- |
| Páginas, layout, búsqueda TopBar, scroll y tokens `-ink` | `app/AGENTS.md` |
| Densidad de pantalla (A1–A6), checklist UI y tableros | `app/(app)/AGENTS.md` |
| Capas compartidas de UI | `components/AGENTS.md` |
| Migraciones y journal | `db/AGENTS.md` |
| QA, MonkeyTest, e2e y locators | `qa/AGENTS.md` |

Puertas que el repo usa (pasarlas antes de declarar terminado):

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Tests unitarios rápidos: `npm run test:fast`
- Tests con PGlite: `npm run test:pglite`
- Un solo archivo: `npx vitest run <ruta>` (PGlite: `--config vitest.pglite.config.ts`)
- Cadena de migraciones: `npm run db:verify-migrations`

Los scripts pasan por `scripts/run-resource-guard.sh`, que toma un lock por usuario Unix: dos validaciones pesadas simultáneas (dos sesiones de agente, dos worktrees) se serializan a propósito en vez de tumbar el servidor. No lo esquives.
<!-- END:verification-commands -->
