<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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

<!-- BEGIN:qa-audit-contract -->
# QA and Browser Audit Contract

This repository uses an AI-assisted browser QA pipeline built around Playwright and a locally adapted MonkeyTest workflow. The audit pipeline is evidence for product quality; it does **not** replace deterministic unit/integration/E2E tests.

## Canonical commands

Use repository scripts instead of manually invoking the underlying long MonkeyTest command during normal development.

### Standard audit

```bash
npm run audit
```

Use after meaningful user-visible changes such as:

- UI changes;
- forms and validation;
- filters/search;
- navigation changes;
- bug fixes affecting workflows;
- changes to one module or a small set of routes.

The standard audit is intentionally bounded so it can be used during normal development.

### Full audit

```bash
npm run audit:full
```

Use for:

- release/pre-production validation;
- large refactors;
- authentication or authorization changes;
- sidebar/navigation changes;
- `AppShell`, `TopBar`, shared layout or shared navigation changes;
- permission/registry changes;
- shared forms/tables/filter infrastructure;
- cross-module changes;
- changes likely to affect many routes.

`audit:full` is slower and more expensive. Do not run it after trivial changes merely to create a green signal.

### Report-only analysis

If the repository exposes it, use:

```bash
npm run audit:report
```

This re-analyses the latest recorded audit without crawling the application again. If this script is not present in `package.json`, do not invent or assume it exists.

## Mandatory human-readable report

Audits are expected to produce:

```text
qa/reports/latest.md
```

Treat this Markdown file as the primary human-readable QA result. Read it after an audit. Do **not** rely only on MonkeyTest's terminal summary.

The report should distinguish at least:

- confirmed product bugs;
- functional findings;
- UI/UX findings;
- inconsistencies;
- automation warnings;
- coverage gaps;
- improvement opportunities;
- console errors;
- network failures;
- route/step coverage;
- prioritized recommendations.

If an audit completes but the report is missing, report the audit pipeline as incomplete instead of pretending the audit succeeded fully.

## MonkeyTest interpretation rule

MonkeyTest may report an overall flow as `passed` even when one or more individual steps were:

- skipped;
- blocked;
- not located;
- not executed;
- impossible for the automation agent to verify.

Therefore:

```text
flow passed != flow fully verified
```

The analysed report and individual step evidence take precedence over the aggregate green/red flow count.

Use these meanings:

### PRODUCT BUG
Confirmed incorrect application behavior supported by evidence.

### FUNCTIONAL FINDING
Suspicious or partially incorrect behavior requiring investigation, without enough evidence yet to call it a confirmed product bug.

### UX FINDING
Observable usability, clarity, feedback, discoverability or navigation problem.

### INCONSISTENCY
Different patterns, terminology, controls or behavior for equivalent concepts.

### AUTOMATION WARNING
The automation could not perform or observe something. This is **not automatically a product bug**.

### COVERAGE GAP
The functionality was not sufficiently tested or could not be reached/verified.

### IMPROVEMENT OPPORTUNITY
The application works, but evidence supports a concrete improvement.

### PASS
Behavior that was actually verified.

Never convert an automation failure into a product bug without evidence.

## Coverage semantics

Never claim:

> 100% of the application was audited.

The crawler can only audit routes and states that it discovers and can reach.

If an audit reports:

```text
187 routes discovered
187 routes visited
0 pending
```

the correct statement is:

> 100% of the discovered routes were processed.

It does **not** prove that every possible route, modal state, conditional workflow or programmatic navigation path in the application was discovered.

For important full audits, compare crawler coverage against:

- `app/(app)/`;
- route/navigation definitions;
- `modules/registry.ts`;
- relevant module manifests;
- permission mappings;
- conditional/programmatic navigation paths.

## Authenticated QA environment

Browser audits use a dedicated authenticated QA session. Relevant local files may include:

```text
.env.qa
playwright/.auth/monkeytest.json
scripts/qa-login.mjs
```

Hard rules:

- Never commit `.env.qa`.
- Never commit `playwright/.auth/`.
- Never print credentials, API keys, session cookies or tokens in logs, reports or chat output.
- Never copy QA credentials into source code.
- Treat Playwright storage state as a credential.
- If the session expires, regenerate the QA session rather than weakening authentication.
- The browser session should carry application authentication; the LLM does not need the application password.

## QA environment safety

Automated exploratory testing must target development, QA or staging unless explicitly authorized otherwise.

Never point unrestricted exploratory automation at production.

Be especially cautious with actions that can:

- delete records;
- approve/reject business operations;
- send email or notifications;
- create financial/legal documents;
- perform payments;
- modify permissions;
- close operational processes;
- trigger external integrations;
- mutate real production data.

Prefer dedicated QA records with a recognizable `QA_` prefix when test data must be created.

## Local MonkeyTest fork

The current development environment may use a locally patched MonkeyTest checkout under:

```text
~/monkeytest-core
```

It can contain project-specific changes such as authenticated Playwright state support, crawl-limit changes and reporting adaptations.

Do **not** during ordinary application work:

- replace it with the npm package;
- reset/reclone it;
- `git restore` its project-specific changes;
- upgrade it blindly;
- assume upstream MonkeyTest behavior exactly matches the local fork.

Normal application work should interact with QA through repository scripts such as `npm run audit` and `npm run audit:full`, not by modifying the QA engine.

## Test strategy

Use the smallest useful verification first:

| Change | Preferred verification |
|---|---|
| Pure logic | Unit tests |
| Business/service logic | Service/integration tests |
| Server actions/forms | Validation/action tests + UI verification when user-visible |
| UI interaction | Playwright/browser verification |
| Critical user journey | Deterministic Playwright regression test |
| Exploratory product QA | `npm run audit` |
| Cross-application/release QA | `npm run audit:full` |

AI exploratory testing complements deterministic tests. It does not replace them.

## When an audit finds something

Do not blindly fix every generated finding.

For each finding:

1. Inspect its evidence.
2. Reproduce it independently when feasible.
3. Classify it as product bug, UX problem, inconsistency, automation limitation, coverage gap or improvement opportunity.
4. Fix confirmed product issues or intentional improvements only after understanding the cause.
5. Re-run the relevant targeted verification.
6. Add regression coverage for important confirmed defects.

If something could not be tested, say so explicitly. Missing evidence must never be silently converted into success.
<!-- END:qa-audit-contract -->

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

When permission/navigation behavior changes across the application, prefer `npm run audit:full` after targeted tests pass.
<!-- END:authorization-navigation -->

<!-- BEGIN:db-migrations -->
# Database migrations: never hand-edit the journal

Drizzle applies a migration only if its `when` in `db/migrations/meta/_journal.json`
is greater than the max `created_at` already recorded in `__drizzle_migrations`.
Hand-editing those timestamps once broke the whole chain — `drizzle-kit migrate`
started **silently skipping** migrations and prod ended up missing columns while
reporting "applied successfully".

Hard rules (full explanation in `db/migrations/README.md`):

- **Never edit `meta/_journal.json` by hand**, especially the `when` values. Let
  `drizzle-kit generate` produce them; they must stay strictly increasing.
- **Never edit an already-created migration `.sql`.** Change `db/schema/*.ts` and
  run `npm run db:generate` to create a NEW migration.
- **Never "force" a migration by bumping its `when`.** That is what caused the
  incident; if a migration won't apply, the journal is broken — fix the journal,
  not the timestamp.
- **Use `db:migrate`, not `db:push`, on any DB that carries history** (prod uses
  `migrate`). `push` doesn't record migrations and desyncs the journal.
- After generating, verify `npm run db:generate` then reports "No schema changes".
- Custom SQL (functions/triggers/non-RBAC data) goes appended to the generated
  migration, idempotent, separated by `--> statement-breakpoint`. RBAC is seeded
  via `npm run db:seed`, never in migrations.
<!-- END:db-migrations -->

<!-- BEGIN:page-layout -->
# Page layout rules (CRITICAL for new pages)

Every authenticated page lives under `app/(app)/` and is wrapped by `AppShell`
→ `TopBar` (sticky header) → `<main>` (scrollable). The shell already handles
title, breadcrumbs, search, and spacing. New pages must follow these rules
to avoid duplicate UI and broken spacing.

## 1. NEVER add a standalone search input to new pages

The `TopBar` (`components/layout/top-bar.tsx`) already renders a global search
input ("Filtrar en esta página...") on **every route** except those that need
server-side search: `/solicitudes`, `/aprobaciones`, `/compras`, `/recepcion`,
`/prevencion/ppa`.

- If your page needs client-side filtering of an already-loaded list, use the
  `searchQuery` from `useSafeShellHeader()` — the TopBar feeds it.
- If your page needs server-side search, add the route prefix to
  `ROUTES_WITH_OWN_SEARCH` in `top-bar.tsx` and build your own search input.
- **Never add a standalone search `<input>` inside page content** — the TopBar already provides one.

## 2. ALWAYS use `<PageHeader>` for titles — never add your own `<h1>`

`PageHeader` (`components/ui/page-header.tsx`) is `lg:sr-only` on desktop.
It pushes `title`, `description`, `breadcrumb`, and `actions` into the
`TopBar` via `ShellHeaderContext` — that is how the header gets its content.

```tsx
import { PageHeader } from "@/components/ui/page-header"

<PageHeader
  title="Mi Página"
  description="Descripción corta"
  actions={<Button>Nueva acción</Button>}
/>
```

- Do NOT add a visible `<h1>` outside `PageHeader` — it causes double titles.
- Do NOT skip `PageHeader` — the TopBar will appear empty on desktop.
- `headerActions` prop renders only in the TopBar (desktop); `actions` renders
  in both TopBar (desktop) and PageHeader (mobile). Prefer `actions`.

## 3. ALWAYS wrap content with `<PageContainer>`

`PageContainer` (`components/ui/page-container.tsx`) provides consistent
padding (`px-4 md:px-8 py-2 md:py-3`) and max-width. Choose a width:

| `width`      | Max-width  | Use case                          |
|-------------|------------|-----------------------------------|
| `wide`      | 1760px     | Tables, dashboards, lists (default) |
| `form`      | 896px      | Compact forms, narrow reads       |
| `workbench` | 1408px     | Detail views with sidebar panels  |
| `full`      | none       | Tables needing horizontal scroll  |

```tsx
import { PageContainer } from "@/components/ui/page-container"

<PageContainer>
  {/* your page content */}
</PageContainer>
```

## 4. Do NOT add extra spacing wrappers around PageContainer

`PageContainer` already applies padding. Do not add outer `<div className="p-6">`
or `<section className="pt-8">` around it — this creates whitespace gaps.
Internal spacing between sections should use `gap-*` or `space-y-*` **inside**
`PageContainer`.

## 5. Page-level action buttons (import, export, create, etc.) go in `PageHeader`'s `actions` — never as a separate inline toolbar

Buttons like "Nuevo producto", "Exportar Excel", "Importar" operate on the whole
page/list, not on a single row — they are page-level actions and belong in
`PageHeader`'s `actions` prop (see rule 2) so they render consistently in the
`TopBar` (desktop) and header block (mobile).

- Do NOT build a `toolbar` div inside a list/table component and render it
  next to `TabsList` or above a `DataTable` — that duplicates the header's
  job, scrolls out of view with the table, and reads as a second header.
- If the action needs local component state (e.g. opening a sheet or a
  choice dialog), lift the trigger and state into the page-level client
  component that renders `PageHeader`, or expose a callback prop — don't
  leave the button buried in a nested list component.
- If a page needs several related import/export flows, prefer **one** entry
  point button with a dialog to disambiguate over multiple similarly-named
  buttons (e.g. one "Importar" button that asks *what* to import, not
  "Importar EPP" + "Importar catálogo" side by side).

## 6. Minimal page template

```tsx
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function MyNewPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Título de la página"
        description="Breve descripción"
        actions={<SomeButton />}
      />
      {/* Page content here — no extra wrappers with padding */}
    </PageContainer>
  )
}
```

## 7. Estándar Visual SaaS (Sidebar 1:1, TopBar Transparente y Tarjetas Flotantes)

- **Sidebar 1:1:** Fondo blanco puro (`bg-white`), encabezado de sección micro-uppercase (`PLATAFORMA`), ítems con pills redondeados suaves (`rounded-xl bg-slate-100 font-semibold text-slate-900`) y perfil de usuario fijado al fondo del panel.
- **TopBar integrado en Desktop:** En escritorio el `TopBar` se mantiene transparente (`bg-transparent border-b-0`), proyectando el título de página y la barra de controles directamente sobre el lienzo sin franjas ni bordes rígidos.
- **Mainzone / Tarjetas flotantes:** Las vistas (tablas, gráficos, listas) flotan sobre el lienzo tenue (`bg-[#f8fafc]`) como contenedores blancos redondeados (`bg-white border border-slate-200/70 rounded-2xl p-6 shadow-xs`).

## 8. Color de texto: siempre tokens `-ink`, nunca los base

Los tokens base `--color-signal`, `--color-warning` y `--color-accent` son colores de
superficie/acento: sobre fondo claro miden 2.3–2.7:1 y **fallan WCAG AA (4.5:1)** como
texto. Para texto (y para íconos que comunican estado) usa SIEMPRE la variante `-ink`
(`--color-warning-ink` = 8.75:1, `--color-signal-ink` = 9.43:1). `--color-danger` y
`--color-success` sí pasan como texto (5.9:1 y 8.1:1), pero sus `-ink` siguen siendo la
opción por defecto sobre tints. Un barrido del 2026-08-05 limpió 28 archivos que
usaban warning/signal como color de texto; no lo reintroduzcas. Botones primarios: usa
`<Button variant="primary">` (texto blanco) — nunca una clase local con un token
inventado (`--color-primary-contrast` no existe y así nació el peor bug de contraste
de la plataforma).
<!-- END:page-layout -->

<!-- BEGIN:shared-ui-fix-rule -->
# Fix Shared UI Problems at the Correct Layer

When the same UI defect can affect multiple pages, inspect the shared primitive before adding a page-local override.

Examples:

- wrong page spacing → inspect `PageContainer` / shell usage;
- duplicate titles → inspect `PageHeader`;
- duplicate search → inspect TopBar/DataTable integration;
- inconsistent buttons → inspect `Button`;
- inconsistent fields → inspect `Field`;
- inconsistent empty states → inspect `EmptyState`;
- inconsistent export behavior → inspect `ExportButton` / `ExportDialog`.

Do not spread local class overrides across pages to compensate for a shared-component problem.
<!-- END:shared-ui-fix-rule -->

<!-- BEGIN:search-architecture -->
# Search architecture

Search in this app has two layers: **text search** (TopBar) and **structured
filters** (page-level). Understanding which layer handles what prevents
duplicate inputs and broken filtering.

## TopBar text search (global)

The `TopBar` (`components/layout/top-bar.tsx`) renders a search input
("Filtrar en esta página...") that writes to `searchQuery` in
`ShellHeaderContext`. This input is visible on **every route** except those
listed in `ROUTES_WITH_OWN_SEARCH` (`/solicitudes`, `/aprobaciones`,
`/compras`, `/recepcion`, `/prevencion/ppa`).

## DataTable auto-connects to TopBar

`DataTable` (`components/admin/data-table.tsx`) already calls
`useSafeShellHeader()` internally. When no explicit `search` prop is given,
it uses `searchQuery` from the TopBar to filter rows client-side via the
`searchKeys` prop.

```tsx
// This DataTable automatically filters via TopBar search — no extra work needed
<DataTable
  columns={COLUMNS}
  rows={data}
  searchKeys={["name", "email"]}  // fields to search
/>
```

- Do NOT add a search `<Input>` to components that use `DataTable` without
  the `search` prop — the TopBar already handles it.
- The `searchPlaceholder` prop is only used when an explicit `search` prop is
  provided (for server-side filtering). It is dead code otherwise.
- For server-side filtered pages, pass `disableInternalSearch` to prevent
  the in-memory filter from also running on top of the server results.

## Structured filters (page-level)

Pages can have their own **structured filters** — dropdowns, date pickers,
select menus — alongside the TopBar text search. These are different from
text search inputs and do NOT conflict with the TopBar.

```tsx
// Good: structured filters + TopBar text search
<div className="flex gap-2">
  <Select>{/* status filter */}</Select>
  <DatePicker>{/* date range */}</DatePicker>
</div>
```

The key distinction:
- **Text search** → TopBar handles it (via `searchQuery` / `DataTable`)
- **Structured filters** → Page handles them locally (dropdowns, dates, toggles)

## Server-side search (rare)

A few routes need server-side search because the dataset is too large for
client-side filtering or requires DB-level queries. These routes are listed
in `ROUTES_WITH_OWN_SEARCH` in `top-bar.tsx`, which hides the TopBar search
input so users don't see two search bars with different behavior.

If your page needs server-side search:
1. Add the route prefix to `ROUTES_WITH_OWN_SEARCH`
2. Build your own search input (URL-synced or server action)
3. Do NOT use `useSafeShellHeader()` for filtering — the TopBar search is
   hidden on these routes
<!-- END:search-architecture -->

<!-- BEGIN:screen-density-rules -->
# Screen density rules (avoid the "wall of stuff" screen)

Cada pantalla debe pasar el **test de los 5 segundos**: al abrirla, sin
scrollear, el usuario entiende *qué es*, *en qué estado está su trabajo* y
*qué acción se espera de él*. Estas seis reglas (A1–A6) existen para eso.
Derivan de la auditoría `PLAN_MEJORA_UX_PANTALLAS_2026-07-16.md`.

## A1 — Máximo 4 tiles de KPI sobre el contenido

- No más de **4 tarjetas** de métrica arriba del contenido principal. Cada
  una debe ser accionable (clic = filtra o navega); si un número no cambia
  ninguna decisión, va abajo o se elimina.
- Los KPIs secundarios van en una fila compacta de texto (patrón
  `WarehouseHeaderMetrics` / la "tira editorial" `MetricBar`), no en tarjetas.
- Un tile en estado vacío muestra la acción para dejar de estarlo, nunca "0"
  ni "—" pelados.

### Excepción declarada: el tablero (`/dashboard`)

Inicio pinta **una vista a la vez** (`?vista=`) y cada vista es un dominio
completo, no una pantalla de gestión con una lista debajo: no hay "contenido
principal" que los tiles puedan sepultar. Ahí el tope es de **8 tiles por
vista**, y sobre 4 la fila se parte en **grupos rotulados**
(`DomainSection.kpiGroups`) — Finanzas separa "Ingresos" de "Egresos". Ocho
cifras seguidas sin ese corte se leen como una sola lista indistinguible, que es
el defecto que A1 previene.

Lo que **no** se relaja:

- Cada tile sigue siendo accionable y sigue llevando a su subconjunto, no al
  total (lo verifica `e2e/densidad-kpi.spec.ts`).
- **A5 sigue rigiendo**: una cifra no puede estar en dos vistas del tablero, ni
  dos veces en la misma. Por eso el gasto en OC se fue de Adquisiciones cuando
  nació Finanzas, y el cumplimiento PDTP salió de la fila de tiles al ganar su
  medidor radial.
- El resto de las pantallas conserva el tope de 4 sin excepciones.

## A2 — Muro de filtros: 4–6 primarios + "Más filtros (N)"

- Máximo 4–6 filtros primarios visibles (los de uso diario: período, faena,
  estado/fuente, búsqueda). El resto va en un `<details>`/Collapsible o
  `Sheet` rotulado "Más filtros" **con contador de activos**.
- Chips removibles de filtros activos bajo la barra (ver
  `combustibles/bitacora/page.tsx`).

## A3 — Lista + acción en el header, no formulario permanente

- La página **es la lista/tabla**. Crear/registrar se dispara desde
  `PageHeader.actions` y abre un `Dialog`/`Sheet` — nunca un formulario
  siempre abierto ocupando el flujo (repite la regla 5 de layout).
- Excepción: estaciones de captura repetitiva (p. ej. `entregas`) pueden
  dejar el form inline pero **plegable**, con la preferencia persistida.
- Si hay varios flujos de alta, un solo botón que pregunta *qué* (ver
  `bodega/movement-sheet.tsx`).

## A4 — Estados vacíos en lenguaje de usuario, con CTA

Todo empty-state tiene tres partes: *qué significa* (sin jerga de modelo de
datos) + *qué hacer para llenarlo* + *CTA real* (botón/Link, no una ruta
pegada como texto). Usa `EmptyState` (`components/ui/empty-state.tsx`).

## A5 — Una dimensión = una representación interactiva

Si hay pestañas por estado, no hay además un `Select` de estado ni un tile
por estado. Los contadores van sobre las pestañas (ver `prevencion/ppa`). No
repitas la misma cifra en dos controles.

## A5b — Un gráfico = una unidad por eje

Dos magnitudes de **escala distinta** no comparten eje: la chica queda pegada al
piso e ilegible. Usa eje doble (`yAxisId` + `<YAxis orientation="right">`) o dos
tarjetas.

- Litros (miles) + cargas (decenas) → la serie "Cargas" se aplanaba.
- Tasa de frecuencia (personas) + tasa de gravedad (días) → la de frecuencia se
  aplanaba, aunque las dos digan "× 1.000.000 / HH".
- Conteos + dinero → siempre eje doble, con tick compacto (`$1,2M`) para que
  quepa.

Corolario: **si consultas un campo, dibújalo o no lo consultes.** `amount` se
calculaba y se descartaba en los dos gráficos de flota. Derivada de la auditoría
`AUDITORIA_DASHBOARD_COBERTURA_GERENCIA_2026-07-31.md` (G-04).

## A6 — Consistencia de controles y vocabulario

- **Fechas**: usa el `DatePicker` del design system, no `<input type="date">`
  nativo (su formato depende del locale del navegador).
- **Estados**: nunca muestres el valor crudo de enum (`SUBMITTED`); mapéalo a
  label en español + `Badge`.
- **Abreviaturas de dominio** (`Acc. c/TP`, `HH`, `T1`) llevan `title`/Tooltip
  con el nombre completo, o se renombran.
<!-- END:screen-density-rules -->

<!-- BEGIN:ui-audit-checklist -->
# UI Audit Checklist for Agents

When reviewing or building a page, explicitly consider:

- the 5-second comprehension test;
- KPI count and actionability;
- duplicate representation of the same dimension;
- duplicated text search;
- number of visible primary filters;
- discoverability of active filters;
- empty state + real CTA;
- correct placement of page-level actions;
- loading feedback;
- mutation success/error feedback;
- destructive-action confirmation;
- terminology consistency;
- date-control consistency;
- responsive overflow and clipping;
- keyboard accessibility and visible focus;
- console errors;
- failed network requests.

These checks also apply when interpreting `qa/reports/latest.md`.
<!-- END:ui-audit-checklist -->

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