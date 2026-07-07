# Search Architecture Consistency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the two real search-architecture violations found during the 2026-07-06 audit (`/bodega` claims an "own search" it never built; `/prevencion/ppa` misuses the global TopBar search for a server-side query) so every route matches what `AGENTS.md`'s search-architecture section documents.

**Architecture:** No new patterns. Reuse the two patterns that already exist in the codebase: (a) client-side in-memory filtering via `useSafeShellHeader().searchQuery`, already used by `app/(app)/prevencion/documentacion/documentacion-view.hooks.ts`, and (b) a route's own dedicated search input registered in `ROUTES_WITH_OWN_SEARCH`, already used by `ListFilters` in the Adquisiciones screens. Extract filtering logic into small pure functions (matching the existing `lib/adquisiciones/list-query.ts` convention) so it's unit-testable without a component-testing harness, which this repo doesn't have.

**Tech Stack:** Next.js App Router, React client components, Vitest.

## Global Constraints

- Never add a standalone search `<input>` outside the two documented patterns (`AGENTS.md` "NEVER add a standalone search input to new pages" / "Search architecture" sections).
- A route only goes in `ROUTES_WITH_OWN_SEARCH` (`components/layout/top-bar.tsx`) if it actually renders its own search input — the array is a promise, not an aspiration.
- Keep `AGENTS.md`'s documented route list in sync with `top-bar.tsx`'s actual array on every change to either.
- Follow existing test conventions: pure-function unit tests in `lib/__tests__/*.test.ts` via Vitest (`npm test`), no new test framework.

---

### Task 1: Shared `matchesQuery` helper + fix `/bodega`

`/bodega` is listed in `ROUTES_WITH_OWN_SEARCH` (`top-bar.tsx:52`) which hides the global TopBar search — but nothing under `app/(app)/bodega/*` implements any text search. Fix: give it the client-side filter the array entry implies, using a small shared helper extracted from the one place in the codebase that already does locale-aware substring matching (`documentacion-view.hooks.ts`), instead of writing a third copy of it.

**Files:**
- Modify: `lib/utils.ts` (add `matchesQuery`)
- Test: `lib/__tests__/utils.test.ts` (add `describe("matchesQuery()")`)
- Create: `app/(app)/bodega/filters.ts` (pure filter functions)
- Test: `lib/__tests__/bodega-filters.test.ts`
- Modify: `app/(app)/bodega/bodega-sections.tsx` (wire the filters into `StockSection`/`KardexSection`)
- Modify: `components/layout/top-bar.tsx:52` (drop `/bodega` — it no longer needs to hide the global search since it now has working in-place filtering, same as `/prevencion/documentacion`)

**Interfaces:**
- Produces: `matchesQuery(query: string, values: Array<string | null | undefined>): boolean` from `@/lib/utils` — case/locale-insensitive (es-CL) substring match against any of `values`; empty/whitespace `query` matches everything.
- Produces: `filterStockItems(items: WorksiteStockWithProduct[], query: string): WorksiteStockWithProduct[]` and `filterMovements(movements: InventoryMovementWithRelations[], query: string): InventoryMovementWithRelations[]` from `@/app/(app)/bodega/filters`.

- [ ] **Step 1: Write the failing test for `matchesQuery`**

Add to `lib/__tests__/utils.test.ts` (extend the existing import list with `matchesQuery`):

```ts
import {
  cn,
  formatCLP,
  formatQty,
  toCode,
  formatDate,
  formatDateTime,
  toTitleCase,
  getInitials,
  escapeHtml,
  matchesQuery,
} from "@/lib/utils"
```

```ts
describe("matchesQuery()", () => {
  it("matches everything when the query is empty", () => {
    expect(matchesQuery("", ["Cemento"])).toBe(true)
    expect(matchesQuery("   ", ["Cemento"])).toBe(true)
  })

  it("matches a case-insensitive substring", () => {
    expect(matchesQuery("cem", ["Cemento Portland"])).toBe(true)
  })

  it("matches accented characters regardless of query accents", () => {
    expect(matchesQuery("direccion", ["Dirección Norte"])).toBe(true)
  })

  it("returns false when no value matches", () => {
    expect(matchesQuery("fierro", ["Cemento", "Portland"])).toBe(false)
  })

  it("skips null/undefined values without throwing", () => {
    expect(matchesQuery("cem", [null, undefined, "Cemento"])).toBe(true)
  })

  it("matches against any of several values", () => {
    expect(matchesQuery("norte", ["Cemento", "Faena Norte"])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- utils.test.ts`
Expected: FAIL — `matchesQuery` is not exported from `@/lib/utils`.

- [ ] **Step 3: Implement `matchesQuery`**

Add to `lib/utils.ts`, after `formatQty`:

```ts
/** Case- and locale-insensitive (es-CL) substring match against any of the given values. Empty query matches everything. */
export function matchesQuery(query: string, values: Array<string | null | undefined>): boolean {
  const normalized = query.trim().toLocaleLowerCase("es-CL")
  if (!normalized) return true
  return values.some((value) => value?.toLocaleLowerCase("es-CL").includes(normalized))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- utils.test.ts`
Expected: PASS (all `matchesQuery` cases + existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts lib/__tests__/utils.test.ts
git commit -m "feat(utils): add matchesQuery shared search-filter helper"
```

- [ ] **Step 6: Write the failing test for the bodega filters**

Create `lib/__tests__/bodega-filters.test.ts`:

```ts
/**
 * Unit tests for the /bodega text-filter helpers (Task 1 of the
 * 2026-07-06 search-consistency plan).
 */

import { describe, it, expect } from "vitest"
import { filterStockItems, filterMovements } from "@/app/(app)/bodega/filters"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "@/app/(app)/bodega/types"

function stockItem(overrides: Partial<WorksiteStockWithProduct> = {}): WorksiteStockWithProduct {
  return {
    id: "s1",
    worksiteId: "ws1",
    productId: "p1",
    quantity: 10,
    minStock: 2,
    lastMovementAt: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
    product: { name: "Cemento Portland", sku: "CEM-001", unitOfMeasure: "saco" },
    worksite: { name: "Faena Norte" },
    ...overrides,
  }
}

function movement(overrides: Partial<InventoryMovementWithRelations> = {}): InventoryMovementWithRelations {
  return {
    id: "m1",
    worksiteId: "ws1",
    productId: "p1",
    type: "ingreso_oc",
    quantity: 5,
    stockAfter: 15,
    performedAt: "2026-07-01T00:00:00.000Z",
    reason: null,
    notes: null,
    product: { name: "Cemento Portland" },
    worksite: { name: "Faena Norte" },
    ...overrides,
  }
}

describe("filterStockItems()", () => {
  it("returns all items when the query is empty", () => {
    const items = [stockItem(), stockItem({ id: "s2", product: { name: "Fierro 8mm", sku: null, unitOfMeasure: "u" } })]
    expect(filterStockItems(items, "")).toHaveLength(2)
  })

  it("matches by product name", () => {
    const items = [stockItem(), stockItem({ id: "s2", product: { name: "Fierro 8mm", sku: null, unitOfMeasure: "u" } })]
    expect(filterStockItems(items, "fierro")).toEqual([items[1]])
  })

  it("matches by SKU", () => {
    const items = [stockItem()]
    expect(filterStockItems(items, "CEM-001")).toEqual(items)
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterStockItems([stockItem()], "no existe")).toEqual([])
  })
})

describe("filterMovements()", () => {
  it("returns all movements when the query is empty", () => {
    expect(filterMovements([movement()], "")).toHaveLength(1)
  })

  it("matches by product name", () => {
    expect(filterMovements([movement()], "cemento")).toHaveLength(1)
  })

  it("matches by worksite name", () => {
    expect(filterMovements([movement()], "norte")).toHaveLength(1)
  })

  it("matches by reason or notes", () => {
    const withReason = movement({ reason: "Ajuste por conteo físico" })
    expect(filterMovements([withReason], "conteo")).toEqual([withReason])
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterMovements([movement()], "no existe")).toEqual([])
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- bodega-filters.test.ts`
Expected: FAIL — `app/(app)/bodega/filters` does not exist.

- [ ] **Step 8: Implement the pure filter functions**

Create `app/(app)/bodega/filters.ts`:

```ts
import { matchesQuery } from "@/lib/utils"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"

export function filterStockItems(items: WorksiteStockWithProduct[], query: string): WorksiteStockWithProduct[] {
  return items.filter((item) => matchesQuery(query, [item.product?.name, item.product?.sku]))
}

export function filterMovements(movements: InventoryMovementWithRelations[], query: string): InventoryMovementWithRelations[] {
  return movements.filter((m) => matchesQuery(query, [m.product?.name, m.worksite?.name, m.reason, m.notes]))
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- bodega-filters.test.ts`
Expected: PASS.

- [ ] **Step 10: Wire the filters into `bodega-sections.tsx`**

In `app/(app)/bodega/bodega-sections.tsx`, add the import and thread `searchQuery` through both sections:

```tsx
import { useSafeShellHeader } from "@/components/layout/header-context"
import { filterStockItems, filterMovements } from "./filters"
```

Replace the `StockSection` body from `const sortedWorksites = ...` through the final `return` (currently lines 24–87) with:

```tsx
export function StockSection({ worksites, stockByWorksite, initialWorksiteId, receivingHref, canExportStock }: {
  worksites: WorksiteOption[]
  stockByWorksite: Record<string, WorksiteStockWithProduct[]>
  initialWorksiteId?: string
  receivingHref?: string
  canExportStock?: boolean
}) {
  const { searchQuery } = useSafeShellHeader()

  const sortedWorksites = [...worksites].sort((a, b) => {
    const aHasStock = (stockByWorksite[a.id] ?? []).some((item) => item.quantity > 0)
    const bHasStock = (stockByWorksite[b.id] ?? []).some((item) => item.quantity > 0)
    if (a.id === initialWorksiteId) return -1
    if (b.id === initialWorksiteId) return 1
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })
  // Faenas that genuinely have stock — independent of the search query, so
  // the "Sin stock" footer below never mislabels a faena that has stock but
  // didn't match the current search.
  const worksitesWithAnyStock = sortedWorksites
    .map((ws) => ({ ...ws, items: (stockByWorksite[ws.id] ?? []).filter((item) => item.quantity > 0) }))
    .filter((ws) => ws.items.length > 0)
  const worksitesWithoutStock = sortedWorksites.filter((ws) => !worksitesWithAnyStock.some((stocked) => stocked.id === ws.id))
  const worksitesWithStock = worksitesWithAnyStock
    .map((ws) => ({ ...ws, items: filterStockItems(ws.items, searchQuery) }))
    .filter((ws) => ws.items.length > 0)

  if (worksites.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <EmptyState
          icon={<Warehouse size={24} />}
          title="Sin faenas asignadas"
          description="Tu cuenta no tiene faenas habilitadas para consultar stock."
        />
      </section>
    )
  }

  if (worksitesWithStock.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {searchQuery.trim() ? (
          <EmptyState
            icon={<Package size={24} />}
            title="Sin coincidencias"
            description={`Ningún producto en stock coincide con "${searchQuery.trim()}".`}
          />
        ) : (
          <EmptyState
            icon={<Package size={24} />}
            title="Sin stock registrado"
            description="Los ingresos de recepción aparecerán aquí cuando una orden de compra llegue a faena."
            action={receivingHref ? (
              <Link
                href={receivingHref}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-[13px] font-semibold text-white transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)]"
              >
                Ver recepciones
                <ArrowRight size={14} aria-hidden />
              </Link>
            ) : undefined}
          />
        )}
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <StockTable worksites={worksitesWithStock} canExport={canExportStock} />

      {worksitesWithoutStock.length > 0 && (
        <section className="border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
            <WarningCircle size={14} />
            <span className="font-medium">Sin stock:</span>
            <span>{worksitesWithoutStock.map((ws) => ws.name).join(", ")}</span>
          </div>
        </section>
      )}
    </div>
  )
}
```

Replace the `KardexSection` body (currently lines 90–109) with:

```tsx
export function KardexSection({
  movements,
  worksites,
  canExport,
  pagination,
  hrefForPage,
}: {
  movements: InventoryMovementWithRelations[]
  worksites: WorksiteOption[]
  canExport: boolean
  pagination: ReturnType<typeof resolvePagination>
  hrefForPage: (page: number) => string
}) {
  const { searchQuery } = useSafeShellHeader()
  // ponytail: kardex is server-paginated, so this only filters the movements
  // already loaded on the current page — a match on an older page won't show
  // up. Move to a server-side ilike (like lib/adquisiciones/list-query.ts's
  // textSearchSql) if that gap becomes a real complaint.
  const filteredMovements = filterMovements(movements, searchQuery)

  return (
    <>
      <KardexTable movements={filteredMovements} worksites={worksites} canExport={canExport} />
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
    </>
  )
}
```

- [ ] **Step 11: Remove `/bodega` from `ROUTES_WITH_OWN_SEARCH`**

In `components/layout/top-bar.tsx:52`, change:

```ts
const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion", "/bodega"]
```

to:

```ts
const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion"]
```

- [ ] **Step 12: Manually verify in the browser**

Run: `npm run dev`, log in, go to `/bodega`.
Expected: the global "Filtrar en esta página..." input is visible again (desktop, `sm:` breakpoint+). Typing a product name filters the stock table rows and the kardex rows; clearing the input restores all rows; typing something that matches no stock shows the "Sin coincidencias" empty state instead of the misleading "Sin stock registrado" one.

- [ ] **Step 13: Run the full test suite and commit**

Run: `npm test`
Expected: PASS (no regressions).

```bash
git add app/"(app)"/bodega/filters.ts lib/__tests__/bodega-filters.test.ts app/"(app)"/bodega/bodega-sections.tsx components/layout/top-bar.tsx
git commit -m "fix(bodega): wire real search filtering, drop stale ROUTES_WITH_OWN_SEARCH entry"
```

---

### Task 2: Fix `/prevencion/ppa` — stop repurposing the global TopBar search

`ppa-list.tsx` reads the global `searchQuery` from `useSafeShellHeader()` and feeds it into a debounced **server-side** query — the exact thing `AGENTS.md`'s "Server-side search (rare)" section says not to do ("Do NOT use `useSafeShellHeader()` for filtering — the TopBar search is hidden on these routes"). Fix: give it its own input and register the route, same as the four Adquisiciones screens.

**Files:**
- Create: `app/(app)/prevencion/ppa/list-filters.ts` (pure filter-state → `PpaListClientFilters` builder)
- Test: `lib/__tests__/ppa-list-filters.test.ts`
- Modify: `app/(app)/prevencion/ppa/ppa-list.tsx` (own `search` state + input, drop `useSafeShellHeader`)
- Modify: `components/layout/top-bar.tsx:52` (add `/prevencion/ppa`)
- Modify: `AGENTS.md:64` and `AGENTS.md:153-154` (keep the documented route list in sync)

**Interfaces:**
- Consumes: `PpaListClientFilters` type from `@/app/(app)/prevencion/ppa/actions` (already defined: `{ estado?, tipoTrabajo?, worksiteId?, search?, dateFrom?, dateTo? }`).
- Produces: `buildPpaListFilters(state: PpaListFilterState): PpaListClientFilters` from `@/app/(app)/prevencion/ppa/list-filters`, where `PpaListFilterState = { estado: string; worksiteId: string; search: string; dateFrom: string; dateTo: string }`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/ppa-list-filters.test.ts`:

```ts
/**
 * Unit tests for the /prevencion/ppa filter-state → server-filters builder
 * (Task 2 of the 2026-07-06 search-consistency plan).
 */

import { describe, it, expect } from "vitest"
import { buildPpaListFilters } from "@/app/(app)/prevencion/ppa/list-filters"

const EMPTY = { estado: "", worksiteId: "", search: "", dateFrom: "", dateTo: "" }

describe("buildPpaListFilters()", () => {
  it("returns all-undefined filters for empty state", () => {
    expect(buildPpaListFilters(EMPTY)).toEqual({
      estado: undefined,
      worksiteId: undefined,
      search: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it("drops a blank/whitespace-only search", () => {
    expect(buildPpaListFilters({ ...EMPTY, search: "   " }).search).toBeUndefined()
  })

  it("trims a non-empty search", () => {
    expect(buildPpaListFilters({ ...EMPTY, search: "  Juan Pérez  " }).search).toBe("Juan Pérez")
  })

  it("passes estado and worksiteId through unchanged", () => {
    const result = buildPpaListFilters({ ...EMPTY, estado: "pendientes", worksiteId: "ws-1" })
    expect(result.estado).toBe("pendientes")
    expect(result.worksiteId).toBe("ws-1")
  })

  it("converts dateFrom to a start-of-day ISO string", () => {
    const result = buildPpaListFilters({ ...EMPTY, dateFrom: "2026-07-01" })
    expect(result.dateFrom).toBe(new Date("2026-07-01T00:00:00").toISOString())
  })

  it("converts dateTo to an end-of-day ISO string", () => {
    const result = buildPpaListFilters({ ...EMPTY, dateTo: "2026-07-01" })
    expect(result.dateTo).toBe(new Date("2026-07-01T23:59:59.999").toISOString())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ppa-list-filters.test.ts`
Expected: FAIL — `app/(app)/prevencion/ppa/list-filters` does not exist.

- [ ] **Step 3: Implement `buildPpaListFilters`**

Create `app/(app)/prevencion/ppa/list-filters.ts`:

```ts
import type { PpaListClientFilters } from "./actions"

export interface PpaListFilterState {
  estado: string
  worksiteId: string
  search: string
  dateFrom: string
  dateTo: string
}

export function buildPpaListFilters(state: PpaListFilterState): PpaListClientFilters {
  return {
    estado: state.estado || undefined,
    worksiteId: state.worksiteId || undefined,
    search: state.search.trim() || undefined,
    dateFrom: state.dateFrom ? new Date(`${state.dateFrom}T00:00:00`).toISOString() : undefined,
    // Include the full end day (up to 23:59:59.999).
    dateTo: state.dateTo ? new Date(`${state.dateTo}T23:59:59.999`).toISOString() : undefined,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ppa-list-filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/"(app)"/prevencion/ppa/list-filters.ts lib/__tests__/ppa-list-filters.test.ts
git commit -m "feat(ppa): extract pure buildPpaListFilters helper"
```

- [ ] **Step 6: Wire an own search input into `ppa-list.tsx`**

In `app/(app)/prevencion/ppa/ppa-list.tsx`:

Replace the import block (lines 1–21) with:

```tsx
"use client"

import * as React from "react"
import Link from "next/link"
import { MagnifyingGlass, ShieldCheck } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { cn, formatDateTime } from "@/lib/utils"
import type { PpaRow } from "@/lib/services/ppa"
import { estadoPpaLabel, estadoPpaBadgeVariant, ESTADO_PPA_LABELS } from "@/lib/ppa/badges"
import { tipoTrabajoLabel } from "@/lib/ppa/types"
import { listPpaAction, type PpaListClientFilters } from "./actions"
import { buildPpaListFilters } from "./list-filters"
```

(This drops `useSafeShellHeader` and adds `MagnifyingGlass` + `Input` + `buildPpaListFilters`.)

Replace the state/filters block (lines 39–62) with:

```tsx
export function PpaList({ initialRows, total: initialTotal, pageSize, worksiteOptions, canReview }: Props) {
  const [rows, setRows] = React.useState(initialRows)
  const [total, setTotal] = React.useState(initialTotal)
  const [page, setPage] = React.useState(1)
  const [pending, startTransition] = React.useTransition()

  const [search, setSearch] = React.useState("")
  const [estado, setEstado] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")

  const filtersActive = !!(estado || worksiteId || search.trim() || dateFrom || dateTo)
  const firstRender = React.useRef(true)

  const filters = React.useMemo<PpaListClientFilters>(
    () => buildPpaListFilters({ estado, worksiteId, search, dateFrom, dateTo }),
    [estado, worksiteId, search, dateFrom, dateTo],
  )
```

Update `clearFilters` (originally lines 85–88) to also reset the new state:

```tsx
  function clearFilters() {
    setPage(1)
    setEstado(""); setWorksiteId(""); setDateFrom(""); setDateTo(""); setSearch("")
  }
```

Add the search input as the first control in the "Filtros detallados" row (originally starting at line 124), right before the estado `<Select>`:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => onFilterChange(() => setSearch(e.target.value))}
            placeholder="Buscar por trabajador o tarea..."
            aria-label="Buscar"
            className="h-8 w-48 pl-8 text-xs sm:w-64"
          />
        </div>

        <Select value={estado || "all"} onValueChange={(v) => onFilterChange(() => setEstado(v === "all" ? "" : v))}>
```

(everything else in that block is unchanged — only inserting the search `<div>` before the existing `<Select>`.)

- [ ] **Step 7: Register the route and update the docs**

In `components/layout/top-bar.tsx:52`, change:

```ts
const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion"]
```

to:

```ts
const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion", "/prevencion/ppa"]
```

In `AGENTS.md:64`, change:

```
server-side search: `/solicitudes`, `/aprobaciones`, `/compras`, `/recepcion`.
```

to:

```
server-side search: `/solicitudes`, `/aprobaciones`, `/compras`, `/recepcion`,
`/prevencion/ppa`.
```

In `AGENTS.md:153-154`, change:

```
listed in `ROUTES_WITH_OWN_SEARCH` (`/solicitudes`, `/aprobaciones`,
`/compras`, `/recepcion`).
```

to:

```
listed in `ROUTES_WITH_OWN_SEARCH` (`/solicitudes`, `/aprobaciones`,
`/compras`, `/recepcion`, `/prevencion/ppa`).
```

- [ ] **Step 8: Manually verify in the browser**

Run: `npm run dev`, log in, go to `/prevencion/ppa`.
Expected: the global TopBar search input is gone (route is now in `ROUTES_WITH_OWN_SEARCH`). The new search box next to the "Estado" filter works: typing a worker name triggers the existing 250ms-debounced server refetch and updates the table; "Limpiar filtros" clears it along with the other filters.

- [ ] **Step 9: Run the full test suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add app/"(app)"/prevencion/ppa/ppa-list.tsx components/layout/top-bar.tsx AGENTS.md
git commit -m "fix(ppa): give /prevencion/ppa its own search input instead of the global one"
```

---

### Task 3 (optional cleanup): De-duplicate the documentacion search filter

`app/(app)/prevencion/documentacion/documentacion-view.hooks.ts` hand-rolls the same locale-aware substring match that Task 1 extracted into `matchesQuery`. Not a bug — just one of the four divergent implementations the audit flagged. Skip this task if you only want the two real violations fixed; it's a pure refactor with no behavior change, safe to do any time after Task 1.

**Files:**
- Modify: `app/(app)/prevencion/documentacion/documentacion-view.hooks.ts:54,268-271`

**Interfaces:**
- Consumes: `matchesQuery` from `@/lib/utils` (Task 1).

- [ ] **Step 1: Replace the local `matchesSearch` with `matchesQuery`**

In `documentacion-view.hooks.ts`, add the import:

```ts
import { matchesQuery } from "@/lib/utils"
```

Replace:

```ts
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("es-CL")
  const matchesSearch = React.useCallback((values: Array<string | null | undefined>) => {
    if (!normalizedSearchQuery) return true
    return values.some((value) => value?.toLocaleLowerCase("es-CL").includes(normalizedSearchQuery))
  }, [normalizedSearchQuery])
```

with:

```ts
  const matchesSearch = React.useCallback(
    (values: Array<string | null | undefined>) => matchesQuery(searchQuery, values),
    [searchQuery],
  )
  const isFilteringQuery = searchQuery.trim().length > 0
```

Then update the one remaining use of `normalizedSearchQuery` — the `isFiltering` line just below `filteredDocuments` — to read `isFilteringQuery` instead of `normalizedSearchQuery.length > 0`.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — no behavior change, this is a pure refactor (there's no existing test file for this hook; the check here is the full suite staying green plus the manual smoke test below).

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, go to `/prevencion/documentacion`, type into the global search.
Expected: folder/document filtering behaves exactly as before (case- and accent-insensitive).

- [ ] **Step 4: Commit**

```bash
git add app/"(app)"/prevencion/documentacion/documentacion-view.hooks.ts
git commit -m "refactor(documentacion): reuse shared matchesQuery instead of local copy"
```

---

## Explicitly out of scope

- Unifying the debounce delay (350ms in `ListFilters` vs 250ms in `/prevencion/ppa`) or migrating `/prevencion/ppa` to full URL-synced filters like `ListFilters`. No bug was found — just cosmetic divergence. Would touch more files for no functional gain; revisit only if `/prevencion/ppa` needs bookmarkable/shareable filter URLs.
- Migrating `/bodega`'s custom grouped-by-faena tables to the shared `DataTable` component. `DataTable` expects a flat row list; `StockTable`/`KardexTable` render grouped sections with inline edit forms (`MinStockCell`) that `DataTable` doesn't support. Out of scope for a search-consistency fix.

## Self-Review

**Spec coverage:** Both real violations from the audit (`/bodega` false own-search claim, `/prevencion/ppa` misusing global search for server queries) have a task each. The third finding (debounce/case-handling divergence) is explicitly addressed as optional (Task 3 fixes the case-handling half; the debounce-ms half is called out as intentionally skipped).

**Placeholder scan:** No TBDs — every step has complete, copy-pasteable code and exact file:line anchors.

**Type consistency:** `PpaListFilterState` (Task 2) matches the five `useState` fields in `ppa-list.tsx` exactly. `buildPpaListFilters` returns `PpaListClientFilters`, the type already exported by `actions.ts` — no new type invented for the server boundary. `filterStockItems`/`filterMovements` (Task 1) use the exact field names from `app/(app)/bodega/types.ts` (`product?.name`, `product?.sku`, `worksite?.name`, `reason`, `notes`).
