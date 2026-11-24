# Reglas de páginas (`app/`)

Se cargan cuando se trabaja dentro de `app/`. Las reglas globales están en el `AGENTS.md` de la raíz.

Estas secciones vivían en el `AGENTS.md` raíz: los comentarios de código que citan «regla 7 de AGENTS.md», «regla A1» o «Navigation and scroll preservation pattern» se refieren a este archivo o a `app/(app)/AGENTS.md`.

<!-- BEGIN:page-layout -->
# Page layout rules (CRITICAL for new pages)

Every authenticated page lives under `app/(app)/` and is wrapped by `AppShell`
→ `[data-shell-scroll]` (the white "well": the scroll container) → which holds
`TopBar` (a `<header>`, the `banner` landmark, **not** sticky — it scrolls with
the content) and `<main id="main-content">` (your page, and it carries **no
classes** on purpose). The shell already handles title, breadcrumbs, search, and
spacing. New pages must follow these rules to avoid duplicate UI and broken
spacing.

Two consequences worth knowing before you write a page: `sticky top-0` and
`scroll-mt-*` measure against the well, not against `<main>`; and a page-level
`fixed inset-0` overlay anchors to the viewport only because `<main>` has no
`transform`/`filter`/`contain`/`overflow` — do not add any to the shell.

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

- **Sidebar:** relleno `--color-chrome` al ras (parte izquierda de la "L"), rótulos de sección en `text-eyebrow` (caja de oración: «Plataforma», no `PLATAFORMA`), ítems con pills redondeados suaves y perfil de usuario fijado al fondo del panel. **Un solo estado activo para todo el menú** (decisión 2026-11-07): `bg-nav-active-bg text-nav-active-ink font-semibold` con el ícono en `--color-primary`, desde los helpers de `components/layout/nav-rows.tsx`. Nada de `slate-*` ni colores literales en el menú (ver DESIGN.md § Navegación).
- **TopBar integrado en Desktop:** En escritorio el `TopBar` se mantiene transparente (`bg-transparent border-b-0`), proyectando el título de página y la barra de controles directamente sobre el lienzo sin franjas ni bordes rígidos.
- **Mainzone / Tarjetas flotantes:** Las vistas (tablas, gráficos, listas) flotan sobre el lienzo tenue (`bg-[#f8fafc]`) como contenedores blancos redondeados (`bg-white border border-slate-200/70 rounded-2xl p-6 shadow-xs`). Las únicas pantallas exceptuadas son los tableros: Inicio (`/dashboard`) y los tableros de Control operacional (`/flota/indicadores` y los Paneles de Mantención y Combustible, `/mantencion/panel` y `/combustibles`); ver la excepción declarada a continuación. Todo lo demás conserva las tarjetas flotantes.

### Excepción declarada: los tableros (`/dashboard` y los Indicadores), superficie y cifras

El tablero se aparta de las tarjetas flotantes **sólo en `/dashboard`** (todas sus
vistas) **y en los tres tableros de Control operacional**
(`/flota/indicadores` y los Paneles `/mantencion/panel` y `/combustibles`, que
desde el 2026-11-14 SON los Indicadores de su dominio; decisión del usuario
2026-11-13/14: son tableros de análisis del período sin una lista principal, con
6–8 gráficos cada uno y en su mayoría gráficos: ver A1), y por una razón observada: al compararlo con tableros de referencia, una
tarjeta flotante por bloque —cada KPI, cada gráfico, cada lista con su propio
borde, radio y sombra— producía ruido visual (decenas de rectángulos del mismo
peso compitiendo) y el ojo no distinguía qué era un grupo y qué un bloque suelto. Un
panel por grupo se lee como un solo sistema.

- **Un panel por grupo, divisiones con línea fina.** `DashboardPanel`
  (`components/ui/dashboard-panel.tsx`) es el único contenedor con borde,
  `rounded-2xl` y fondo; sus celdas (`PanelBlock`, `ChartSlot`, y los tiles de
  `KpiCard surface="flat"`) se separan por 1px con el borde superior e izquierdo
  de cada celda. **Nada de sombra por bloque** ni de una tarjeta dentro de una
  celda. Un `ChartSlot` sin datos se oculta (`empty:hidden`) y el panel entero
  desaparece si ninguna celda tiene contenido: no se dejan huecos ni marcos
  vacíos.
- **Los paneles son `div`, nunca regiones.** `e2e/densidad-kpi-filtros.spec.ts`
  cuenta los tiles por región (A1); un panel con `role="region"` o nombre
  accesible juntaría todos los tiles de la vista y rompería ese conteo. La región
  sigue siendo la sección (`DashboardSection` de
  `components/dashboard/dashboard-section.tsx`; en Inicio, su envoltorio
  `DomainSection`).
- **Cifras en sans, no en mono.** Los números de KPI del tablero van en la fuente
  del cuerpo (Myriad), `font-semibold` y `tabular-nums`: `KpiCard numerals="sans"`,
  que las secciones pasan con `{...DASHBOARD_KPI}` (exportado de
  `components/ui/dashboard-panel.tsx`; `KpiCard` es server component y
  no puede leer contexto, por eso es explícito). El resto de la plataforma sigue con
  `font-mono` en sus cifras (ver DESIGN.md); no lo cambies fuera de los tableros.
- **Una variación se muestra con `Delta`** (`components/ui/delta.tsx`) y **un
  ranking con `RankedList`** (`components/ui/ranked-list.tsx`, un solo tono):
  nada de píldoras o textos sueltos ("-5 vs. mes anterior") ni de barras
  multicolor donde el color no codifica nada.
- **Cada vista parte por lo que responde su pregunta.** El Resumen abre con
  «Hoy» (lo que requiere atención) y las vistas operativas (Prevención,
  Adquisiciones…) con sus tiles, porque lo accionable es una cifra. Finanzas
  abre con los **gráficos** (`DomainSection chartsFirst`): su pregunta es cómo
  evolucionan la facturación y la deuda, y los grupos "Ingresos (facturación de
  venta)" y "Egresos (compra y consumo)" van debajo. Antigüedad de la deuda
  conserva el orden cronológico de los tramos (No vencida → 1–30 → 31–60 → 61–90
  → Más de 90 días), no el orden por monto, y su titular ya dice el saldo
  pendiente y lo vencido: esas cifras no se repiten en un tile (A5).

Lo que **no** se relaja: los tokens de color y texto (regla 8), la accesibilidad de
los gráficos (nombre accesible, `prefers-reduced-motion`) y el tope de tiles por
vista (A1). `e2e/dashboard-rediseno.spec.ts` verifica el orden de Finanzas, los
numerales sans y que ninguna celda de gráfico quede vacía.

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

<!-- BEGIN:search-architecture -->
# Search architecture

Search in this app has two layers: **text search** (TopBar) and **structured
filters** (page-level). Understanding which layer handles what prevents
duplicate inputs and broken filtering.

## TopBar text search (global)

The `TopBar` (`components/layout/top-bar.tsx`) renders a search input
("Filtrar en esta página...") that writes to `searchQuery` in
`ShellHeaderContext`. This input is visible on **every route** except those
listed in `ROUTES_WITH_OWN_SEARCH` (among others `/solicitudes`, `/aprobaciones`,
`/compras`, `/recepcion`, `/prevencion/ppa` and the whole `/combustibles` module,
whose lists each carry their own labelled search; the full list is in `top-bar.tsx`).

## DataTable auto-connects to TopBar

`DataTable` (`components/ui/data-table.tsx`) already calls
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

## Routes that own their search

`ROUTES_WITH_OWN_SEARCH` in `top-bar.tsx` hides the TopBar input so users
don't see two search bars with different behavior. A route belongs there for
one of two reasons:

1. **Server-side search** — the dataset is too large for client-side
   filtering or needs DB-level queries.
2. **More than one `DataTable` on the page** — the TopBar input can only feed
   one of them, so the others would need local inputs and the user would have
   no way to tell which box filters which table. Give every table on the page
   its own labelled input instead (e.g. `/admin/taxonomia-sst`, with
   "Buscar categorías..." and "Buscar tipos...").

If your page needs server-side search:
1. Add the route prefix to `ROUTES_WITH_OWN_SEARCH`
2. Build your own search input (URL-synced or server action)
3. Do NOT use `useSafeShellHeader()` for filtering — the TopBar search is
   hidden on these routes
<!-- END:search-architecture -->

<!-- BEGIN:navigation-scroll-pattern -->
# Navigation and scroll preservation pattern

## Problema reportado

Cuando el usuario aplica un filtro o cambio de contexto y luego regresa a la página anterior:
- Los filtros se pierden
- El scroll retorna al inicio de la página aunque el usuario había scrolleado hacia abajo

Esto ocurre en todo el sistema porque varios componentes usan `router.push()` o `router.replace()` sin `{ scroll: false }` al actualizar la URL con nuevos parámetros.

## Patrón correcto

### 1. Cambios de filtro (MUST use `router.replace` + `scroll: false`)

 Cuando un componente actualiza parámetros de URL que representan **filtros** o **estado de vista** (no navegación intencional del usuario), debe usar:

 ```tsx
 router.replace(url, { scroll: false })
 ```

 Motivos:
 - `replace` evita llenar el historial con cada cambio de filtro
 - `scroll: false` preserva la posición de scroll del usuario
 - Los filtros son estado de la vista, no acciones de navegación

 Ejemplos de lo que debe usar este patrón:
 - Selección de estado, faena, fecha, búsqueda
 - Navegación entre páginas de paginación
 - Apertura/cierre de tabs que viajan en URL
 - Selección de año, período en dashboards

 ### 2. Navegación intencional del usuario (puede usar `router.push`)

 `router.push()` es apropiado cuando el usuario toma una acción que debería agregar una entrada al historial:
 - Navegar a un detalle desde una lista
 - Ir a un formulario de creación
 - Cambiar a una sección completamente diferente

 Pero incluso en estos casos, si el navigation es dentro de la misma página (ej. cambiar de tab), considerar `router.replace` + `scroll: false`.

 ### 3. `<Link>` en paginación

 Los `<Link>` de Next.js hacen scroll al destino por defecto. Para paginación que debe mantener el scroll:

 ```tsx
 <Link href={hrefForPage(page)} scroll={false}>...</Link>
 ```

 ### 4. `router.back()` en formularios

 `router.back()` es correcto para botones "Cancelar/Volver" en formularios, porque navega a la entrada exacta del historial (que debería tener los filtros intactos si la navegación a la entrada actual fue via `<Link>` o `router.replace`).

 Este patrón funciona correctamente cuando:
 1. El usuario está en una página con filtros en URL
 2. Navega a un formulario vía `<Link>` (agrega entrada al historial)
 3. Presiona "Cancelar" → `router.back()` retorna a la URL con filtros

 NO funciona correctamente si la página de origen llegó via una navegación que no conservó los filtros.

## Checklist para nuevos componentes de filtro

- [ ] ¿El cambio actualiza parámetros de URL que representan filtro/estado de vista?
- [ ] ¿Se usa `router.replace()` en vez de `router.push()`?
- [ ] ¿Se pasa `{ scroll: false }` a la navegación?
- [ ] Si es un `<Link>` de paginación, ¿tiene `scroll={false}`?
- [ ] Si usa `useUrlFilters` hook, ¿verificar que el hook tiene `scroll = false` por defecto?

## Archivos afectados por este patrón

Esta sección documenta los cambios realizados para corregir el problema:

| Componente | Cambio |
|------------|--------|
| `flota/fleet-filters.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `bodega/guias/guide-filters.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `analitica/analytics-filters.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `facturacion/facturas/invoice-filters.tsx` | `startTransition(() => router.push)` → `router.replace` + `scroll: false` |
| `combustibles/reportes/reports-view.tsx` | `router.push` → `router.replace` + `scroll: false` (retirado el 2026-10-22: `/combustibles/reportes` redirige a «Consumo y rendimiento») |
| `prevencion/miper/miper-workbench.tsx` | `router.push` → `router.replace` + `scroll: false` (navegación imports) |
| `prevencion/capa/capa-list.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/pdtp/acciones/acciones-table.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/pdtp/[programId]/reporte/reporte-gestion-filters.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/pdtp/pdtp-sheet-table-ui.tsx` | 6 instancias `router.push` → `router.replace` + `scroll: false` |
| `prevencion/pdtp/pdtp-sheet-table.tsx` | `router.replace` + `scroll: false` (faltaba) |
| `ti/activos/asset-filters.tsx` | `router.replace` + `scroll: false` (faltaba) |
| `prevencion/privacidad/solicitudes/privacy-requests-workbench.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/indicadores-material-ambiental/material-environmental-dashboard.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/cgrd/cgrd-workbench.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/cphs/[committeeId]/programa/program-panel.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/cphs/[committeeId]/certificacion/certification-panel.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `prevencion/indicadores/canonical-indicators-dashboard.tsx` | `router.push` → `router.replace` + `scroll: false` |
| `components/ui/server-pagination.tsx` | Agregado `scroll={false}` a `<Link>`s |
| `components/ui/data-table.tsx` | Ya tenía `scroll: false` (confirmado) |

<!-- END:navigation-scroll-pattern -->
