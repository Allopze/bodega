<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
- See `modules/README.md` and the audit at `.claude/plans/shiny-scribbling-lynx.md` (finding A1) for the reconciliation plan.
<!-- END:source-of-truth -->

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

## 8. Estándar Visual SaaS (Sidebar 1:1, TopBar Transparente y Tarjetas Flotantes)

- **Sidebar 1:1:** Fondo blanco puro (`bg-white`), encabezado de sección micro-uppercase (`PLATAFORMA`), ítems con pills redondeados suaves (`rounded-xl bg-slate-100 font-semibold text-slate-900`) y perfil de usuario fijado al fondo del panel.
- **TopBar integrado en Desktop:** En escritorio el `TopBar` se mantiene transparente (`bg-transparent border-b-0`), proyectando el título de página y la barra de controles directamente sobre el lienzo sin franjas ni bordes rígidos.
- **Mainzone / Tarjetas flotantes:** Las vistas (tablas, gráficos, listas) flotan sobre el lienzo tenue (`bg-[#f8fafc]`) como contenedores blancos redondeados (`bg-white border border-slate-200/70 rounded-2xl p-6 shadow-xs`).
<!-- END:page-layout -->

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

## A6 — Consistencia de controles y vocabulario

- **Fechas**: usa el `DatePicker` del design system, no `<input type="date">`
  nativo (su formato depende del locale del navegador).
- **Estados**: nunca muestres el valor crudo de enum (`SUBMITTED`); mapéalo a
  label en español + `Badge`.
- **Abreviaturas de dominio** (`Acc. c/TP`, `HH`, `T1`) llevan `title`/Tooltip
  con el nombre completo, o se renombran.
<!-- END:screen-density-rules -->

<!-- BEGIN:form-export-patterns -->
# Form, export and date formatting standards

## 1. Form Operation Pattern (`useOperation` & `Field`)
- Use `useOperation` from `@/lib/hooks/use-operation` for form submissions with `useTransition` and user feedback.
- ALWAYS use `Field` from `@/components/ui/field` for input wrappers (with accessible `Label`, `error`, `helper`/`hint` support). Never create local `form-kit.tsx` files or unaccessible `<label>` wrappers.
- Use `toLocalInputValue` from `@/lib/utils` for formatting local Date objects in `<input type="datetime-local">`.

## 2. Export Pattern (`ExportButton` & `ExportDialog`)
- Direct exports (Server Actions): Use `ExportButton` from `@/components/ui/export-button`.
- Filtered exports (Modal dialog): Use `ExportDialog` from `@/components/export-dialog`.
- Never duplicate base64 download logic or create standalone export buttons.

## 3. Date Formatting
- ALWAYS use `formatDate` or `formatDateTime` from `@/lib/utils`.
- NEVER use `toLocaleDateString()` directly in `.tsx` components to prevent locale mismatch inconsistencies across browsers.
<!-- END:form-export-patterns -->

