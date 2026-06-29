# Combustibles Security & Integrity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 12 findings from the AUDITORIA-COMBUSTIBLES.md audit, eliminating data-leak between worksites, financial corruption vectors in the import API, and missing audit trail.

**Architecture:** Each fix is surgical — no new files except the Drizzle migration for H10. All changes go in `lib/combustibles/`, `app/(app)/combustibles/`, and `app/api/combustibles/`. Tests follow the existing Vitest + vi.mock() pattern used in `actions-vehicles.test.ts` and `lib/combustibles/__tests__/`.

**Tech Stack:** Next.js server components + server actions, Drizzle ORM (postgres-js driver), Zod, Vitest.

## Global Constraints

- Never edit an existing migration `.sql` file or `_journal.json` — run `npm run db:generate` to create new migrations.
- All exports must use XLSX (not CSV). This plan does not touch export; constraint is here for awareness.
- Run `npm test` after every task before committing.
- Typecheck with `npm run typecheck` before committing.
- `db.transaction()` is supported by the postgres-js driver already in use.
- `canAccessWorksite`, `isGlobalRole` are exported from `@/lib/auth/can` (re-exported from scope.ts).
- `requirePermission(permission)` returns `Promise<Session>` on success, throws on failure.

---

### Task 1: H1a — Scope-check per-ID fuel load reads

**Files:**
- Modify: `app/(app)/combustibles/[id]/page.tsx`
- Test: `app/(app)/combustibles/actions-loads.test.ts` (new file — see Task 3 which creates it)

**Problem:** `[id]/page.tsx` fetches a fuel load by ID with no worksite scope check. Any user with `combustibles:view` can read `/combustibles/<any-id>`.

**Interfaces:**
- Consumes: `requirePermission("combustibles:view")` → `Session`, `canAccessWorksite(session, worksiteId)` → `boolean`
- Produces: `notFound()` when the session lacks access to the load's worksite

- [ ] **Step 1: Understand the current file**

Read `app/(app)/combustibles/[id]/page.tsx`. Current shape:
```typescript
try { await requirePermission("combustibles:view") }
catch { redirect("/forbidden") }
// ... fetches load without capturing session ...
if (!load) notFound()
// no scope check
```

- [ ] **Step 2: Write the fix**

Replace the page file with the scoped version. The key changes are:
1. Capture `session` from `requirePermission`
2. Import `canAccessWorksite` from `@/lib/auth/can`
3. After `if (!load) notFound()`, add `if (!canAccessWorksite(session, load.worksiteId)) notFound()`
4. Scope vehicle/supplier/worksite dropdown lists to accessible worksites (H12 — dropdowns sin scope)

```typescript
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EditFuelLoadForm } from "./edit-fuel-load-form"

export default async function FuelLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const [load, vehicles, suppliersList, worksitesList] = await Promise.all([
    db.query.fuelLoads.findFirst({
      where: eq(fuelLoads.id, id),
      with: { vehicle: true, supplier: true, worksite: true },
    }),
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      orderBy: [fuelVehicles.plate],
    }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({
      where: worksiteScopeSql(session, worksites.id),
      orderBy: [worksites.name],
    }),
  ])

  if (!load) notFound()
  if (!canAccessWorksite(session, load.worksiteId)) notFound()

  return (
    <PageContainer>
      <PageHeader
        title={`Carga — ${load.receiptNumber ?? "Sin número"}`}
        description={`${load.loadDate} · ${load.serviceType} · ${load.vehicle?.plate ?? "—"}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: `Carga ${load.receiptNumber ?? load.id.slice(0, 8)}` }]} />}
      />

      <EditFuelLoadForm
        load={load}
        vehicles={vehicles.map(v => ({ id: v.id, plate: v.plate, type: v.type }))}
        suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))}
        worksites={worksitesList.map(w => ({ id: w.id, name: w.name }))}
      />
    </PageContainer>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors related to this file.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/combustibles/[id]/page.tsx"
git commit -m "fix(combustibles): scope per-ID fuel load reads to session worksite (H1a)"
```

---

### Task 2: H1b — Gate cuenta corriente to global roles

**Files:**
- Modify: `app/(app)/combustibles/cuenta-corriente/page.tsx`
- Modify: `app/(app)/combustibles/cuenta-corriente/[id]/page.tsx`

**Problem:** Cuenta corriente is intrinsically global (aggregates all worksites per supplier). Scoped roles (`solicitante_faena`, `prevencionista_faena`, `admin_contrato`) with `combustibles:view` can access it and see all worksites' financial data.

**Fix:** Add an `isGlobalRole` gate immediately after permission check. Scoped roles get redirected to `/forbidden`.

**Interfaces:**
- Consumes: `isGlobalRole(session)` → `boolean` (exported from `@/lib/auth/can`)

- [ ] **Step 1: Fix cuenta-corriente/page.tsx**

```typescript
import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { desc } from "drizzle-orm"
import { requirePermission, isGlobalRole } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StatementsTable } from "./statements-table"
import { NewStatementDialog } from "./new-statement-dialog"

export default async function CuentaCorrientePage() {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  if (!isGlobalRole(session)) redirect("/forbidden")

  const [statements, suppliersList] = await Promise.all([
    db.query.fuelMonthlyStatements.findMany({
      with: { supplier: true, payments: true },
      orderBy: [desc(fuelMonthlyStatements.month)],
    }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Cuenta corriente de combustible"
        description="Resúmenes mensuales por proveedor y control de pagos"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Cuenta corriente" }]} />}
        actions={
          <div className="flex gap-2">
            <NewStatementDialog suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))} />
          </div>
        }
      />
      <StatementsTable statements={statements} />
    </PageContainer>
  )
}
```

- [ ] **Step 2: Fix cuenta-corriente/[id]/page.tsx**

```typescript
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelMonthlyStatements } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission, isGlobalRole } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StatementDetail } from "./statement-detail"

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  if (!isGlobalRole(session)) redirect("/forbidden")

  const { id } = await params

  const statement = await db.query.fuelMonthlyStatements.findFirst({
    where: eq(fuelMonthlyStatements.id, id),
    with: {
      supplier: true,
      payments: true,
      loads: { with: { vehicle: true, worksite: true } },
    },
  })

  if (!statement) notFound()

  return (
    <PageContainer>
      <PageHeader
        title={`Resumen ${statement.month}`}
        description={`${statement.supplier?.name ?? "Proveedor"} — ${statement.loads?.length ?? 0} cargas`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Combustibles", href: "/combustibles" },
            { label: "Cuenta corriente", href: "/combustibles/cuenta-corriente" },
            { label: `${statement.month} — ${statement.supplier?.name ?? ""}` },
          ]} />
        }
      />
      <StatementDetail statement={statement} />
    </PageContainer>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/combustibles/cuenta-corriente/page.tsx" "app/(app)/combustibles/cuenta-corriente/[id]/page.tsx"
git commit -m "fix(combustibles): gate cuenta corriente to global roles (H1b)"
```

---

### Task 3: H6 + H5 — Worksite scope and statement-guard in mutation actions

**Files:**
- Modify: `app/(app)/combustibles/actions.ts`
- Create: `app/(app)/combustibles/actions-loads.test.ts`

**Problems addressed:**
- H6: `updateFuelLoadAction`, `deleteFuelLoadAction`, `registerFuelLoadAction` don't validate the worksite of the existing record.
- H5: `updateFuelLoadAction` allows editing financial fields of loads already assigned to a statement (`statementId` is set), causing statement totals to drift.

**Interfaces:**
- Consumes: `canAccessWorksite(session, worksiteId)` → `boolean`
- The session must be captured from `requirePermission` in each action.

- [ ] **Step 1: Write failing tests**

Create `app/(app)/combustibles/actions-loads.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockFindLoad = vi.fn()
const mockDeleteWhere = vi.fn(async () => undefined)
const mockUpdateWhere = vi.fn(async () => undefined)
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))
vi.mock("@/db", () => ({
  db: {
    delete: () => ({ where: mockDeleteWhere }),
    update: () => ({ set: mockUpdateSet }),
    query: {
      fuelLoads: {
        findFirst: (...args: unknown[]) => mockFindLoad(...args),
      },
    },
  },
}))
vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

import { deleteFuelLoadAction, registerFuelLoadAction } from "./actions"

const globalSession = {
  user: { id: "user-1", roles: ["administrador"], worksiteIds: [], isGlobal: true, permissions: ["combustibles:delete", "combustibles:create"] },
}
const scopedSession = {
  user: { id: "user-2", roles: ["solicitante_faena"], worksiteIds: ["ws-mine"], isGlobal: false, permissions: ["combustibles:delete", "combustibles:create"] },
}

describe("deleteFuelLoadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(scopedSession)
    mockCanAccessWorksite.mockReturnValue(false)
  })

  it("returns error when session cannot access the load worksite", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-other", statementId: null, status: "registered" })
    mockCanAccessWorksite.mockReturnValue(false)

    const result = await deleteFuelLoadAction("load-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena|acceso/i)
    expect(mockDeleteWhere).not.toHaveBeenCalled()
  })

  it("deletes when session has access to the load worksite", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-mine", statementId: null, status: "registered" })
    mockCanAccessWorksite.mockReturnValue(true)

    const result = await deleteFuelLoadAction("load-1")

    expect(result.ok).toBe(true)
    expect(mockDeleteWhere).toHaveBeenCalled()
  })
})

describe("registerFuelLoadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(scopedSession)
  })

  it("returns error when session cannot access the load worksite", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-other", status: "draft" })
    mockCanAccessWorksite.mockReturnValue(false)

    const result = await registerFuelLoadAction("load-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena|acceso/i)
    expect(mockUpdateWhere).not.toHaveBeenCalled()
  })
})

describe("updateFuelLoadAction — statement guard (H5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(globalSession)
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("blocks edit when load is assigned to a statement", async () => {
    mockFindLoad.mockResolvedValue({
      id: "load-1", worksiteId: "ws-1", statementId: "stmt-1", status: "registered",
      loadDate: "2026-01-15", month: "2026-01", serviceType: "TCT",
      vehicleId: "v-1", fuelSupplierId: "s-1", product: "PETROLEO DIESEL",
      receiptNumber: null, odometerReading: null, hourMeterReading: null,
      liters: 100, iecFixed: 0, iecVariable: 0, baseAmount: 1000, iecTotal: 0, ivaAmount: 190, totalAmount: 1190,
      notes: null,
    })

    const fd = new FormData()
    fd.set("id", "load-1")
    fd.set("liters", "200")
    fd.set("baseAmount", "2000")
    fd.set("iecFixed", "0")
    fd.set("iecVariable", "0")
    fd.set("iecTotal", "0")
    fd.set("ivaAmount", "380")
    fd.set("totalAmount", "2380")
    fd.set("loadDate", "2026-01-15")
    fd.set("serviceType", "TCT")
    fd.set("vehicleId", "v-1")
    fd.set("fuelSupplierId", "s-1")
    fd.set("worksiteId", "ws-1")
    fd.set("product", "PETROLEO DIESEL")

    const result = await (await import("./actions")).updateFuelLoadAction({ ok: false, message: "" }, fd)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cuenta corriente|resumen/i)
    expect(mockUpdateWhere).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- actions-loads
```
Expected: tests fail because worksite checks don't exist yet.

- [ ] **Step 3: Implement the fixes in actions.ts**

In `updateFuelLoadAction` (around line 145), after fetching `existing`, add:

```typescript
// H5: block editing loads already assigned to a statement
if (existing.statementId) {
  return { ok: false, message: "No se puede editar una carga asignada a una cuenta corriente" }
}
// H6: validate worksite access
if (!canAccessWorksite(session, existing.worksiteId)) {
  return { ok: false, message: "Sin acceso a la faena de esta carga" }
}
```

Note: `session` must also be captured in `updateFuelLoadAction`. Change the top of that function from:
```typescript
try { await requirePermission("combustibles:create") }
catch { return { ok: false, message: "Sin permisos" } }
```
to:
```typescript
let session
try { session = await requirePermission("combustibles:create") }
catch { return { ok: false, message: "Sin permisos" } }
```

In `deleteFuelLoadAction` (around line 206), after fetching `existing`, add:

```typescript
if (!canAccessWorksite(session, existing.worksiteId)) {
  return { ok: false, message: "Sin acceso a la faena de esta carga" }
}
```

Note: `session` must be captured. Change the top from:
```typescript
try { await requirePermission("combustibles:delete") }
catch { return { ok: false, message: "Sin permisos para eliminar" } }
```
to:
```typescript
let session
try { session = await requirePermission("combustibles:delete") }
catch { return { ok: false, message: "Sin permisos para eliminar" } }
```

In `registerFuelLoadAction` (around line 228), after fetching `existing`, add:

```typescript
if (!canAccessWorksite(session, existing.worksiteId)) {
  return { ok: false, message: "Sin acceso a la faena de esta carga" }
}
```

Note: `session` must be captured. Change from:
```typescript
try { await requirePermission("combustibles:create") }
```
to:
```typescript
let session
try { session = await requirePermission("combustibles:create") }
```

The `canAccessWorksite` import is already present in `actions.ts` at line 16.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- actions-loads
```
Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/combustibles/actions.ts" "app/(app)/combustibles/actions-loads.test.ts"
git commit -m "fix(combustibles): add worksite scope check and statement guard to mutations (H5, H6)"
```

---

### Task 4: H4 — Fix IEC corruption in the edit form

**Files:**
- Modify: `app/(app)/combustibles/[id]/edit-fuel-load-form.tsx`

**Problem:** The `useEffect` in the edit form recalculates IEC/IVA/Total with `iecFixedRate: null, iecVariableRate: null` (which yields IEC = 0) every time `liters` or `baseAmount` change. This zeroes out any real IEC from an imported load the moment the user opens the edit page and makes a change.

**Fix:** Remove the dependency on `calculateFuelAmounts` with null rates. Instead:
- Preserve `iecFixed`, `iecVariable`, `iecTotal` from the existing load (state initialized from props stays).
- Only recompute `ivaAmount` (19% of baseAmount, always calculable) and `totalAmount`.
- Keep `liters` out of the effect's dependencies — IEC proportional to liters can't be recomputed without rates on the client.

- [ ] **Step 1: Remove the faulty useEffect and the calculateFuelAmounts import**

In `edit-fuel-load-form.tsx`:

1. Remove the import of `calculateFuelAmounts` (line 6):
```typescript
import { calculateFuelAmounts } from "@/lib/combustibles/calculations"
```

2. Replace the existing useEffect (lines 59–66):
```typescript
useEffect(() => {
  const calc = calculateFuelAmounts({ liters, baseAmount, iecFixedRate: null, iecVariableRate: null })
  setIecFixed(calc.iecFixed)
  setIecVariable(calc.iecVariable)
  setIecTotal(calc.iecTotal)
  setIvaAmount(calc.ivaAmount)
  setTotalAmount(calc.totalAmount)
}, [liters, baseAmount])
```

With:
```typescript
useEffect(() => {
  // IEC components are preserved from the existing load (rates aren't available client-side).
  // Only IVA (always 19%) and total are recalculated when baseAmount changes.
  const iva = Math.round(baseAmount * 0.19 * 100) / 100
  setIvaAmount(iva)
  setTotalAmount(Math.round((baseAmount + iecTotal + iva) * 100) / 100)
}, [baseAmount, iecTotal])
```

The `liters` state variable and setter can stay (they're used as a controlled input).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors (calculateFuelAmounts is no longer imported here).

- [ ] **Step 3: Verify manually**

Open the edit page for a fuel load that has non-zero IEC values (e.g., an imported one). Change the base amount. Confirm: `iecFixed`, `iecVariable`, `iecTotal` remain unchanged; `ivaAmount` and `totalAmount` update correctly.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/combustibles/[id]/edit-fuel-load-form.tsx"
git commit -m "fix(combustibles): preserve existing IEC values in edit form (H4)"
```

---

### Task 5: H2 + H3 + H7 — Harden the import API route

**Files:**
- Modify: `app/api/combustibles/import/route.ts`

**Problems addressed:**
- H2: Financial amounts from the client are inserted without coherence validation.
- H3: No deduplication against existing loads → re-importing duplicates all data.
- H7: Worksite/vehicle/supplier creation and load inserts are not wrapped in a transaction; concurrent imports can leave partial data.

**Fix:** Port the safety logic from the dead `importFuelLoadsAction` into the API route:
1. Add a Zod schema to validate every load in the payload.
2. Add financial coherence check: `|totalAmount - (baseAmount + iecTotal + ivaAmount)| ≤ 1`.
3. Add worksite scope check per load (using the session from `requirePermission`).
4. Query existing loads for the months in the file and build a dedup `Set`.
5. Wrap all DB writes in `db.transaction()`.

- [ ] **Step 1: Write failing tests**

Create `app/api/combustibles/import/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockFindManyLoads = vi.fn()
const mockFindManyVehicles = vi.fn()
const mockFindManySuppliers = vi.fn()
const mockFindManyWorksites = vi.fn()
const mockTransaction = vi.fn()

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))

vi.mock("@/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
    query: {
      fuelVehicles: { findMany: (...args: unknown[]) => mockFindManyVehicles(...args) },
      fuelSuppliers: { findMany: (...args: unknown[]) => mockFindManySuppliers(...args) },
      worksites: { findMany: (...args: unknown[]) => mockFindManyWorksites(...args) },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

const session = { user: { id: "user-1", isGlobal: true, worksiteIds: [] } }
const validLoad = {
  rowIndex: 2,
  loadDate: "2026-01-15",
  month: "2026-01",
  serviceType: "TCT",
  vehicle: "CAMION",
  supplier: "COPEC",
  worksite: "FAENA BIODIVERSA",
  product: "PETROLEO DIESEL",
  receiptNumber: "29533428",
  liters: 100,
  iecFixed: 10,
  iecVariable: 8,
  baseAmount: 500,
  iecTotal: 18,
  ivaAmount: 95,
  totalAmount: 613,  // 500 + 18 + 95 = 613 ✓
}

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/combustibles/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("POST /api/combustibles/import", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    mockCanAccessWorksite.mockReturnValue(true)
    mockFindManyVehicles.mockResolvedValue([{ id: "v-1", plate: "CAMION" }])
    mockFindManySuppliers.mockResolvedValue([{ id: "s-1", name: "COPEC" }])
    mockFindManyWorksites.mockResolvedValue([{ id: "w-1", name: "Faena Biodiversa", code: "FN-FAENA", isActive: true }])
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue(undefined) }))
  })

  it("rejects payload with incoherent financial amounts (H2)", async () => {
    const badLoad = { ...validLoad, totalAmount: 9999 } // doesn't match base+iec+iva
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [badLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(res.status).toBe(200)
    // Load should appear in errors, not be imported
    expect(json.imported).toBe(0)
    expect(json.errors).toHaveLength(1)
    expect(json.errors[0].field).toMatch(/TOTAL/i)
  })

  it("deduplicates loads already in the DB (H3)", async () => {
    // Simulate existing load with same natural key
    const existingLoad = {
      fuelSupplierId: "s-1",
      receiptNumber: "29533428",
      vehicleId: "v-1",
      loadDate: "2026-01-15",
      liters: 100,
    }
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([existingLoad]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      }
      return fn(tx)
    })

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(json.imported).toBe(0)
    expect(json.errors[0].field).toMatch(/FACTURA/i)
  })

  it("rejects loads from worksites the user cannot access (H7 scope)", async () => {
    mockCanAccessWorksite.mockReturnValue(false)

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(json.imported).toBe(0)
    expect(json.errors[0].field).toMatch(/FAENA/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- route.test
```
Expected: tests fail.

- [ ] **Step 3: Rewrite the route with hardened logic**

Replace the full contents of `app/api/combustibles/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"

const CREATE_FAENA = "__create__"
const SKIP_FAENA = "__skip__"

const parsedFuelLoadSchema = z.object({
  rowIndex:         z.number().int(),
  loadDate:         z.string().min(1),
  month:            z.string().regex(/^\d{4}-\d{2}$/),
  serviceType:      z.enum(["TCT", "TAE"]),
  vehicle:          z.string().min(1),
  supplier:         z.string().min(1),
  worksite:         z.string().min(1),
  product:          z.string().min(1),
  receiptNumber:    z.string(),
  odometerReading:  z.number().nullable().optional(),
  hourMeterReading: z.number().nullable().optional(),
  liters:           z.number().min(0),
  iecFixed:         z.number().default(0),
  iecVariable:      z.number().default(0),
  baseAmount:       z.number().positive(),
  iecTotal:         z.number().default(0),
  ivaAmount:        z.number().min(0).default(0),
  totalAmount:      z.number().min(0),
})

const importBodySchema = z.object({
  loads:        z.array(parsedFuelLoadSchema),
  createMissing: z.boolean().default(false),
  faenaMapping: z.record(z.string()).default({}),
})

const TITLE_LOWER = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "a"])

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\p{L}+/gu, (word, idx: number) =>
    idx > 0 && TITLE_LOWER.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
  )
}

function makeWorksiteCode(name: string, taken: Set<string>): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "FAENA"
  let code = `FN-${slug}`
  let i = 1
  while (taken.has(code)) code = `FN-${slug}-${i++}`
  taken.add(code)
  return code
}

const loadKey = (supplierId: string, receipt: string | null, vehicleId: string, loadDate: string, liters: number) =>
  `${supplierId}::${(receipt ?? "").toUpperCase()}::${vehicleId}::${loadDate}::${liters}`

export async function POST(req: NextRequest) {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { return NextResponse.json({ ok: false, message: "Sin permisos" }, { status: 403 }) }

  let body: z.infer<typeof importBodySchema>
  try {
    const raw = await req.json()
    const parsed = importBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "Payload inválido", details: parsed.error.flatten() }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ ok: false, message: "JSON inválido" }, { status: 400 })
  }

  const { loads, createMissing, faenaMapping } = body
  if (loads.length === 0) {
    return NextResponse.json({ ok: false, message: "No hay cargas para importar" }, { status: 400 })
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [allVehicles, allSuppliers, allWorksites] = await Promise.all([
        tx.query.fuelVehicles.findMany(),
        tx.query.fuelSuppliers.findMany(),
        tx.query.worksites.findMany(),
      ])

      const vehicleMap = new Map(allVehicles.map(v => [v.plate.toUpperCase(), v.id]))
      const supplierMap = new Map(allSuppliers.map(s => [s.name.toUpperCase(), s.id]))
      const worksiteMap = new Map(allWorksites.map(w => [w.name.toUpperCase(), w.id]))

      // Resolve faena mapping (create new worksites if requested)
      const takenCodes = new Set(allWorksites.map(w => w.code))
      const resolvedFaena = new Map<string, string | null>()
      for (const [fileFaena, target] of Object.entries(faenaMapping)) {
        if (target === SKIP_FAENA) { resolvedFaena.set(fileFaena, null); continue }
        if (target === CREATE_FAENA) {
          const id = nanoid()
          const name = toTitleCase(fileFaena)
          await tx.insert(worksites).values({ id, name, code: makeWorksiteCode(fileFaena, takenCodes), isActive: true })
          resolvedFaena.set(fileFaena, id)
          worksiteMap.set(fileFaena.toUpperCase(), id)
        } else {
          resolvedFaena.set(fileFaena, target)
        }
      }

      // Deduplication: query existing loads for the months in this file (H3)
      const monthsInFile = [...new Set(loads.map(l => l.month))]
      const existingLoads = monthsInFile.length > 0
        ? await tx.select({
            fuelSupplierId: fuelLoads.fuelSupplierId,
            receiptNumber: fuelLoads.receiptNumber,
            vehicleId: fuelLoads.vehicleId,
            loadDate: fuelLoads.loadDate,
            liters: fuelLoads.liters,
          }).from(fuelLoads).where(inArray(fuelLoads.month, monthsInFile))
        : []
      const seenLoads = new Set(
        existingLoads.map(l => loadKey(l.fuelSupplierId, l.receiptNumber, l.vehicleId, l.loadDate, l.liters)),
      )

      const toInsert: typeof fuelLoads.$inferInsert[] = []
      const importErrors: Array<{ rowIndex: number; field: string; message: string }> = []
      const created: Array<{ type: string; name: string }> = []

      for (const load of loads) {
        // Financial coherence (H2): totalAmount must equal base + IEC + IVA within ±1 CLP
        const expectedTotal = load.baseAmount + load.iecTotal + load.ivaAmount
        if (Math.abs(load.totalAmount - expectedTotal) > 1) {
          importErrors.push({ rowIndex: load.rowIndex, field: "TOTAL FACTURA", message: `Total ${load.totalAmount} no cuadra con base+IEC+IVA (${expectedTotal})` })
          continue
        }

        let vehicleId = vehicleMap.get(load.vehicle.toUpperCase())
        let supplierId = supplierMap.get(load.supplier.toUpperCase())

        const mapped = resolvedFaena.has(load.worksite) ? resolvedFaena.get(load.worksite) : undefined
        if (mapped === null) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `"${load.worksite}" omitida` })
          continue
        }
        const worksiteId = mapped ?? worksiteMap.get(load.worksite.toUpperCase())

        // Scope check (H7): session must have access to this worksite
        if (worksiteId && !canAccessWorksite(session, worksiteId)) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `Sin acceso a la faena "${load.worksite}"` })
          continue
        }

        if (!vehicleId && createMissing) {
          const id = nanoid()
          await tx.insert(fuelVehicles).values({ id, plate: load.vehicle, type: "camion", isActive: true })
          vehicleId = id
          vehicleMap.set(load.vehicle.toUpperCase(), id)
          created.push({ type: "vehículo", name: load.vehicle })
        }
        if (!supplierId && createMissing) {
          const id = nanoid()
          await tx.insert(fuelSuppliers).values({ id, name: load.supplier, isActive: true })
          supplierId = id
          supplierMap.set(load.supplier.toUpperCase(), id)
          created.push({ type: "proveedor", name: load.supplier })
        }
        if (!worksiteId) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FAENA", message: `"${load.worksite}" no encontrada` })
          continue
        }
        if (!vehicleId) {
          importErrors.push({ rowIndex: load.rowIndex, field: "VEHICULO", message: `"${load.vehicle}" no encontrado` })
          continue
        }
        if (!supplierId) {
          importErrors.push({ rowIndex: load.rowIndex, field: "PROVEEDOR", message: `"${load.supplier}" no encontrado` })
          continue
        }

        // Deduplication (H3): skip loads already in the DB
        const key = loadKey(supplierId, load.receiptNumber || null, vehicleId, load.loadDate, load.liters)
        if (seenLoads.has(key)) {
          importErrors.push({ rowIndex: load.rowIndex, field: "FACTURA", message: `Carga duplicada (factura "${load.receiptNumber}", ${load.loadDate})` })
          continue
        }
        seenLoads.add(key)

        toInsert.push({
          id: nanoid(),
          loadDate: load.loadDate, month: load.month, serviceType: load.serviceType,
          vehicleId, fuelSupplierId: supplierId, worksiteId,
          product: load.product, receiptNumber: load.receiptNumber || null,
          odometerReading: load.odometerReading ?? null,
          hourMeterReading: load.hourMeterReading ?? null,
          liters: load.liters, iecFixed: load.iecFixed, iecVariable: load.iecVariable,
          baseAmount: load.baseAmount, iecTotal: load.iecTotal, ivaAmount: load.ivaAmount,
          totalAmount: load.totalAmount, status: "registered", createdBy: session.user.id,
        })
      }

      if (toInsert.length > 0) {
        await tx.insert(fuelLoads).values(toInsert)
      }

      return { imported: toInsert.length, errors: importErrors, created }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    logger.error("import API error", { error: e })
    return NextResponse.json({ ok: false, message: "Error al importar" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- route.test
```
Expected: all 3 tests pass.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
npm test && npm run typecheck
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "app/api/combustibles/import/route.ts" "app/api/combustibles/import/route.test.ts"
git commit -m "fix(combustibles): harden import API with Zod validation, dedup, scope, and transaction (H2, H3, H7)"
```

---

### Task 6: H8 — Add audit logging for financial operations

**Files:**
- Modify: `app/(app)/combustibles/actions.ts`

**Problem:** No audit trail for fuel load create/update/delete, statement creation, or payment registration.

**Pattern:** Use `recordAudit(params, tx)` from `@/lib/audit` — pass `tx` inside transactions so audit records are in the same transaction. Pass `db` for standalone operations.

- [ ] **Step 1: Write failing tests**

Add to `app/(app)/combustibles/actions-loads.test.ts` (at the bottom, before the closing):

```typescript
// -- Audit logging (H8) --

const mockRecordAudit = vi.fn()
vi.mock("@/lib/audit", () => ({ recordAudit: (...args: unknown[]) => mockRecordAudit(...args) }))

describe("createFuelLoadAction — audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(globalSession)
    mockCanAccessWorksite.mockReturnValue(true)
    mockRecordAudit.mockResolvedValue(undefined)
  })

  it("records an audit entry after successful create", async () => {
    const fd = new FormData()
    fd.set("loadDate", "2026-01-15")
    fd.set("serviceType", "TCT")
    fd.set("vehicleId", "v-1")
    fd.set("fuelSupplierId", "s-1")
    fd.set("worksiteId", "ws-1")
    fd.set("product", "PETROLEO DIESEL")
    fd.set("liters", "100")
    fd.set("baseAmount", "1000")
    fd.set("iecFixed", "10")
    fd.set("iecVariable", "8")
    fd.set("iecTotal", "18")
    fd.set("ivaAmount", "190")
    fd.set("totalAmount", "1208")

    const { createFuelLoadAction } = await import("./actions")
    await createFuelLoadAction({ ok: false, message: "" }, fd)

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", entityType: "fuel_load" }),
    )
  })
})
```

Note: the test for `createFuelLoadAction` will also need `mockInsertValues` to be set up from earlier mock setup. The test structure assumes the mock file already has mocks for insert/update from Task 3. If running in isolation, ensure the DB mocks are set up properly.

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- actions-loads
```
Expected: the audit test fails (recordAudit not called).

- [ ] **Step 3: Add audit calls in actions.ts**

Add this import at the top of `actions.ts`:
```typescript
import { recordAudit } from "@/lib/audit"
```

In `createFuelLoadAction`, after the successful `db.insert(fuelLoads)`:
```typescript
await recordAudit({
  userId: session.user.id,
  action: "create",
  entityType: "fuel_load",
  entityId: id,
  newState: { ...parsed.data, worksiteId: parsed.data.worksiteId },
})
```

In `updateFuelLoadAction`, after the successful `db.update(fuelLoads)`:
```typescript
await recordAudit({
  userId: session.user.id,
  action: "update",
  entityType: "fuel_load",
  entityId: id,
  oldState: { liters: existing.liters, baseAmount: existing.baseAmount, totalAmount: existing.totalAmount },
  newState: { liters: parsed.data.liters, baseAmount: parsed.data.baseAmount, totalAmount: parsed.data.totalAmount },
})
```

In `deleteFuelLoadAction`, after the successful `db.delete(fuelLoads)`:
```typescript
await recordAudit({
  userId: session.user.id,
  action: "delete",
  entityType: "fuel_load",
  entityId: id,
  oldState: { worksiteId: existing.worksiteId, totalAmount: existing.totalAmount },
})
```

In `addPaymentAction`, inside the transaction, after the successful payment insert, add (using `tx` as the client):
```typescript
await recordAudit({
  userId: session.user.id,
  action: "create",
  entityType: "fuel_payment",
  entityId: nanoid(),
  newState: { statementId: parsed.data.statementId, amount: parsed.data.amount },
}, tx)
```

In `createMonthlyStatementAction`, inside the transaction, after insert:
```typescript
await recordAudit({
  userId: session.user.id,
  action: "create",
  entityType: "fuel_statement",
  entityId: id,
  newState: { month: parsed.data.month, fuelSupplierId: parsed.data.fuelSupplierId, ...totals },
}, tx)
```

- [ ] **Step 4: Run tests**

```bash
npm test -- actions-loads
```
Expected: audit test passes.

- [ ] **Step 5: Run full suite + typecheck**

```bash
npm test && npm run typecheck
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/combustibles/actions.ts" "app/(app)/combustibles/actions-loads.test.ts"
git commit -m "fix(combustibles): add audit logging to fuel loads, payments, and statements (H8)"
```

---

### Task 7: H11 + H12 — Timezone fix and validation consistency

**Files:**
- Modify: `lib/combustibles/import.ts`
- Modify: `lib/combustibles/validation.ts`
- Modify: `app/(app)/combustibles/actions.ts`

**Problems addressed:**
- H11: `rawDate.toISOString().split("T")[0]` shifts dates one day back on servers west of UTC.
- H12: `baseAmount` allows `min(0)` in `createFuelLoadSchema` but import requires `> 0`; no financial coherence check in manual create/update.

- [ ] **Step 1: Write a failing test for the timezone bug**

Add to `lib/combustibles/__tests__/import.test.ts`:

```typescript
  it("does not shift dates on servers with UTC offset (H11)", () => {
    // A Date at midnight local time: toISOString would give previous day in UTC-X zones.
    // We create the date directly as a JS Date object (as XLSX does with cellDates:true)
    // and verify the parsed loadDate matches the original calendar date.
    const dateWithMidnight = new Date(2026, 0, 15, 0, 0, 0, 0) // Jan 15 at local midnight
    const buffer = createTestExcel([{ ...validRow, "MES-AÑO": dateWithMidnight }])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    // Should always be 2026-01-15 regardless of server timezone offset
    expect(result.loads[0]!.loadDate).toBe("2026-01-15")
    expect(result.loads[0]!.month).toBe("2026-01")
  })
```

- [ ] **Step 2: Run to verify it fails (or is flaky depending on server TZ)**

```bash
npm test -- import.test
```
Expected: may pass in UTC but fail in UTC-N timezones. The fix is still correct.

- [ ] **Step 3: Fix the date parsing in import.ts**

In `lib/combustibles/import.ts`, replace the `rawDate instanceof Date` branch (lines 81–83):

Old:
```typescript
if (rawDate instanceof Date) {
  loadDate = rawDate.toISOString().split("T")[0]!
  month = loadDate.substring(0, 7)
```

New:
```typescript
if (rawDate instanceof Date) {
  const y = rawDate.getFullYear()
  const m = String(rawDate.getMonth() + 1).padStart(2, "0")
  const d = String(rawDate.getDate()).padStart(2, "0")
  loadDate = `${y}-${m}-${d}`
  month = `${y}-${m}`
```

Also fix the `typeof rawDate === "string"` branch below it (line 87):

Old:
```typescript
loadDate = d.toISOString().split("T")[0]!
month = loadDate.substring(0, 7)
```

New:
```typescript
const y = d.getFullYear()
const mo = String(d.getMonth() + 1).padStart(2, "0")
const da = String(d.getDate()).padStart(2, "0")
loadDate = `${y}-${mo}-${da}`
month = `${y}-${mo}`
```

- [ ] **Step 4: Fix baseAmount min in validation.ts (H12)**

In `lib/combustibles/validation.ts`, change line 18:

Old:
```typescript
baseAmount:     z.coerce.number().min(0, "Base afecta requerida"),
```

New:
```typescript
baseAmount:     z.coerce.number().positive("Base afecta debe ser > 0"),
```

- [ ] **Step 5: Add financial coherence check to createFuelLoadAction and updateFuelLoadAction (H12)**

In `actions.ts`, in `createFuelLoadAction`, after `if (!parsed.success)` check and before the worksite check, add:

```typescript
// Financial coherence: total must equal base + IEC + IVA (±1 CLP)
const expectedTotal = parsed.data.baseAmount + parsed.data.iecTotal + parsed.data.ivaAmount
if (Math.abs(parsed.data.totalAmount - expectedTotal) > 1) {
  return { ok: false, message: `Total (${parsed.data.totalAmount}) no cuadra con base + IEC + IVA (${expectedTotal})` }
}
```

Apply the same check in `updateFuelLoadAction`, after `if (!parsed.success)`.

- [ ] **Step 6: Run tests**

```bash
npm test -- import.test
npm test
```
Expected: all pass.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add "lib/combustibles/import.ts" "lib/combustibles/validation.ts" "app/(app)/combustibles/actions.ts"
git commit -m "fix(combustibles): timezone-safe date parsing, consistent baseAmount min, financial coherence on manual create/update (H11, H12)"
```

---

### Task 8: H9 — Remove dead server actions

**Files:**
- Modify: `app/(app)/combustibles/actions.ts`

**Problem:** Eight server actions are exported but never imported anywhere outside the file itself. The most dangerous case is `importFuelLoadsAction` — the safe version with scope/dedupe/coherence — which is dead while the unsafe API route was used. With Task 5 complete, the API route is now as safe as that action was. The other dead actions duplicate logic that already exists inline in pages.

Dead exports to remove (confirmed by grep — zero references outside `actions.ts`):
- `getFuelLoadsAction` (lines ~247–292)
- `importFuelLoadsAction` (lines ~298–444)
- `getFuelVehiclesAction` (lines ~551–562)
- `getFuelSuppliersAction` (lines ~632–640)
- `getMonthlyStatementsAction` (lines ~728–744)
- `getMonthlyStatementByIdAction` (lines ~746–760)
- `getFuelReportAction` (lines ~841–877)
- `getFuelChartDataAction` (lines ~970–986)

Also remove any imports that become unused after deletion (`parseFuelExcel`, `ImportError`, `type ImportError` if not used elsewhere).

- [ ] **Step 1: Verify no external references exist**

```bash
grep -rn "getFuelLoadsAction\|importFuelLoadsAction\|getFuelVehiclesAction\|getFuelSuppliersAction\|getMonthlyStatementsAction\|getMonthlyStatementByIdAction\|getFuelReportAction\|getFuelChartDataAction" \
  app/ lib/ --include="*.ts" --include="*.tsx" \
  | grep -v "actions.ts" | grep -v ".test.ts"
```
Expected: no output. If any file is found, do NOT delete that action — inline the safe version there first.

- [ ] **Step 2: Delete the dead action blocks**

Remove each function block identified above from `actions.ts`. Also:
- Remove `import { parseFuelExcel, type ImportError } from "@/lib/combustibles/import"` if `importFuelLoadsAction` was the only consumer. Verify with grep first:
```bash
grep -n "parseFuelExcel\|ImportError" "app/(app)/combustibles/actions.ts"
```

- [ ] **Step 3: Run full tests + typecheck**

```bash
npm test && npm run typecheck
```
Expected: all pass (the dead code had no callers, so removing it changes nothing observable).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/combustibles/actions.ts"
git commit -m "refactor(combustibles): remove dead server actions (H9)"
```

---

### Task 9: H10 — Drop dead costCenterId column

**Files:**
- Modify: `db/schema/fuel-invoices.ts`
- New migration generated by: `npm run db:generate`

**Problem:** `costCenterId` is a column + index + FK on `fuel_loads` that no code path ever populates. It's a dead column polluting the schema.

**Rule:** Never hand-edit the journal. Generate the migration with `db:generate`.

- [ ] **Step 1: Write a failing schema test**

Add to `lib/combustibles/__tests__/calculations.test.ts` (or create `db/schema/fuel-loads.test.ts`):

No automated test is needed here — schema structure is validated by Drizzle's type system and `npm run db:generate` producing "No schema changes" afterwards. Proceed to implementation.

- [ ] **Step 2: Remove costCenterId from the schema**

In `db/schema/fuel-invoices.ts`:

1. Remove the import of `costCenters` from `"./cost-centers"` (line 7):
```typescript
import { costCenters } from "./cost-centers"
```

2. Remove the `costCenterId` column (line 25):
```typescript
costCenterId:   text("cost_center_id").references(() => costCenters.id),
```

3. Remove the index (line 53):
```typescript
index("fuel_loads_cost_center_idx").on(table.costCenterId),
```

- [ ] **Step 3: Generate the migration**

```bash
npm run db:generate
```
Expected: a new `.sql` file is created in `db/migrations/` with a `ALTER TABLE fuel_loads DROP COLUMN cost_center_id` statement.

- [ ] **Step 4: Verify no more schema changes**

```bash
npm run db:generate
```
Expected output: `No schema changes`.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors (nothing referenced `costCenterId` in application code).

- [ ] **Step 6: Commit**

```bash
git add db/schema/fuel-invoices.ts db/migrations/
git commit -m "refactor(combustibles): drop dead costCenterId column from fuel_loads (H10)"
```

---

## Self-Review

### Spec coverage check

| Finding | Task | Coverage |
|---------|------|----------|
| H1 — data leak per-ID reads + cuenta corriente | Task 1 + Task 2 | ✓ |
| H2 — import trusts client financial amounts | Task 5 | ✓ |
| H3 — import no deduplication | Task 5 | ✓ |
| H4 — IEC zeroed on edit form open | Task 4 | ✓ |
| H5 — statement totals drift on edit | Task 3 | ✓ |
| H6 — update/delete/register skip worksite scope | Task 3 | ✓ |
| H7 — import not transactional, no scope | Task 5 | ✓ |
| H8 — no audit trail | Task 6 | ✓ |
| H9 — dead safe actions | Task 8 | ✓ |
| H10 — dead costCenterId column | Task 9 | ✓ |
| H11 — timezone bug in Excel date parsing | Task 7 | ✓ |
| H12 — validation inconsistencies | Task 7 | ✓ |

### Placeholder scan

No TBD, TODO, or "similar to task N" patterns. All code blocks are complete.

### Type consistency

- `canAccessWorksite(session, worksiteId: string): boolean` — used consistently in Tasks 1, 3, 5.
- `isGlobalRole(session): boolean` — used in Task 2.
- `requirePermission(permission): Promise<Session>` — session captured in all mutating actions in Task 3.
- `recordAudit(params, client?)` — used in Task 6, `tx` passed inside transactions.
- `loadKey(supplierId, receipt, vehicleId, loadDate, liters)` — defined and used only inside Task 5's route file.
- `parsedFuelLoadSchema` in Task 5 is a Zod object; `importBodySchema.parse()` consumes it.

### Edge cases confirmed

- Task 1: `worksiteScopeSql` returns `sql\`false\`` for sessions with no worksiteIds, producing zero results in the dropdowns — correct for scoped roles (they wouldn't normally reach the edit page of an inaccessible load).
- Task 5: The dedup `Set` is built from both the DB and already-queued rows within the same import batch, so two identical rows in the same file are also caught.
- Task 6: Audit records inside `db.transaction()` use `tx` as the client so they roll back together with the main operation on failure.
- Task 7: The string-date branch is also fixed for timezone safety, not only the `instanceof Date` branch.
