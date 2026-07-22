# Prevención — Pendientes accionables (post-auditoría) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los ítems accionables que quedaron abiertos en `docs/auditoria/PLAN_PREVENCION.md` ("Estado final 2026-07-01") — los que se pueden implementar sin una decisión previa de producto/arquitectura.

**Architecture:** Cada feature sigue el patrón ya establecido del área `prevencion`: lógica en `lib/services/prevention-*.ts` (funciones puras con `scope: WorksiteScope`), validación Zod en `lib/validation/prevention.ts`, server actions en `app/(app)/prevencion/<área>/actions.ts` con `guardPermission`, y UI en client components con `Table`/`TableRoot`/`EmptyState` del design system. Tests con PGlite en `lib/__tests__/prevention-*.test.ts`.

**Tech Stack:** Next.js (App Router, versión con breaking changes — leer `node_modules/next/dist/docs/` antes de tocar APIs de Next), Drizzle ORM (Postgres), Zod, Vitest + PGlite, recharts, Excel (`buildXlsxBuffer`, nunca CSV).

## Global Constraints

- Lógica de negocio SOLO en `lib/` + `app/`, nunca en `modules/*` salvo nav/permisos/seed (regla `AGENTS.md`).
- Exports SIEMPRE Excel vía `buildXlsxBuffer`, nunca CSV.
- Cambios de schema → `npm run db:generate` (NUNCA editar `db/migrations/meta/_journal.json` a mano); aplicar con `npm run db:migrate`; verificar que `db:generate` reporte "No schema changes" después.
- Tests e2e/PGlite: correr con `PGHOST=/var/run/postgresql` disponible.
- `WorksiteScope = string[] | "all"`; el helper `scopeToIds(resolveWorksiteScope(session))` convierte la sesión a scope. `resolveWorksiteScope` retorna `{ mode: "all" | "some" | "none", ids?: string[] }`.
- Toda función de servicio que toca datos por faena valida acceso con `assertWorksiteAccess(worksiteId, scope)` (throw `"Sin acceso a esta faena."`).
- `toast` se importa de `@/lib/toast`, nunca de `sonner`.
- Fechas legibles con `formatDateDisplay`/`formatDateSafe` de `@/lib/sst/date`, no `.slice()` crudo ni `toLocaleString` disperso.
- Este plan NO incluye los 6 ítems bloqueados por decisión previa — ver sección final "Decisiones requeridas (fuera de alcance)".

---

## Feature A — Matriz de capacitación por cargo

Vista cruzada cargo × curso: por cada curso con `requiredForCargo` y cada trabajador con ese `position` en el scope, muestra cuántos cumplen (asignación no vencida) vs. cuántos lo requieren. El campo `trainingCourses.requiredForCargo` (jsonb `string[]`) ya existe; falta la vista.

### Task A1: Servicio `getTrainingMatrix`

**Files:**
- Modify: `lib/services/prevention-training.ts` (agregar función al final, antes de cualquier `export` de tipos)
- Test: `lib/__tests__/prevention-training-matrix.test.ts` (crear)

**Interfaces:**
- Consumes: `db`, `trainingCourses`, `workerTrainingAssignments`, `workers` de `@/db/schema`; `WorksiteScope` (tipo local del archivo, `string[] | "all"`).
- Produces: `getTrainingMatrix(scope: WorksiteScope, today: string): Promise<TrainingMatrixRow[]>` donde
  `type TrainingMatrixRow = { courseId: string; courseName: string; cargo: string; requiredCount: number; compliantCount: number }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/__tests__/prevention-training-matrix.test.ts`. Copiar el encabezado PGlite estándar de `lib/__tests__/prevention-training.test.ts` (imports de PGlite/drizzle, `vi.mock("@/db")`, `migratePGlite`, `afterAll`). En `beforeEach` insertar: worksites `ws-1`; users `user-1`; workers `w-op1` (position "operador", ws-1, active), `w-op2` (position "operador", ws-1, active), `w-jt1` (position "jefe_terreno", ws-1, active).

```ts
describe("getTrainingMatrix (Feature A)", () => {
  it("cuenta requeridos por cargo y cumplientes con asignación no vencida", async () => {
    const { createTrainingCourse, assignTrainingToWorker, getTrainingMatrix } = await import("@/lib/services/prevention-training")

    const course = await createTrainingCourse({
      code: "ALT-01", name: "Trabajo en altura", validityMonths: 12,
      requiredForCargo: ["operador"],
    }, "user-1")

    // w-op1 cumple (no vencido); w-op2 no tiene asignación; w-jt1 no aplica (otro cargo)
    await assignTrainingToWorker({
      courseId: course.id, workerId: "w-op1", worksiteId: "ws-1",
      completedAt: "2026-01-01", expiresAt: "2027-01-01",
    }, "user-1", ["ws-1"])

    const matrix = await getTrainingMatrix(["ws-1"], "2026-07-01")
    const row = matrix.find((r) => r.courseId === course.id && r.cargo === "operador")
    expect(row).toBeDefined()
    expect(row!.requiredCount).toBe(2)   // w-op1 + w-op2
    expect(row!.compliantCount).toBe(1)  // solo w-op1
  })

  it("una asignación vencida no cuenta como cumpliente", async () => {
    const { createTrainingCourse, assignTrainingToWorker, getTrainingMatrix } = await import("@/lib/services/prevention-training")
    const course = await createTrainingCourse({
      code: "ALT-02", name: "Altura 2", validityMonths: 12, requiredForCargo: ["operador"],
    }, "user-1")
    await assignTrainingToWorker({
      courseId: course.id, workerId: "w-op1", worksiteId: "ws-1",
      completedAt: "2024-01-01", expiresAt: "2025-01-01",
    }, "user-1", ["ws-1"])
    const matrix = await getTrainingMatrix(["ws-1"], "2026-07-01")
    const row = matrix.find((r) => r.courseId === course.id && r.cargo === "operador")
    expect(row!.compliantCount).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `PGHOST=/var/run/postgresql npx vitest run lib/__tests__/prevention-training-matrix.test.ts`
Expected: FAIL — `getTrainingMatrix is not a function`.

- [ ] **Step 3: Implementar `getTrainingMatrix`**

En `lib/services/prevention-training.ts`, verificar que estén importados `and`, `eq`, `inArray`, `isNull`, `gte`, `or` de `drizzle-orm` (agregar los que falten al import existente) y `workers` de `@/db/schema`. Agregar al final del archivo (antes de exports de tipo, si hay):

```ts
export type TrainingMatrixRow = {
  courseId: string
  courseName: string
  cargo: string
  requiredCount: number
  compliantCount: number
}

// Cruce cargo × curso. Un trabajador "cumple" si tiene una asignación al curso
// cuya expiresAt es null (sin vencimiento) o >= today.
export async function getTrainingMatrix(scope: WorksiteScope, today: string): Promise<TrainingMatrixRow[]> {
  const courses = await listTrainingCourses() // solo activos
  const withCargo = courses.filter((c) => Array.isArray(c.requiredForCargo) && (c.requiredForCargo as string[]).length > 0)
  if (withCargo.length === 0) return []

  const activeWhere = scope === "all"
    ? eq(workers.isActive, true)
    : scope.length === 0
      ? undefined
      : and(eq(workers.isActive, true), inArray(workers.worksiteId, scope))
  if (scope !== "all" && scope.length === 0) return []

  const workerRows = await db.select({ id: workers.id, position: workers.position }).from(workers).where(activeWhere)

  const assignmentWhere = scope === "all"
    ? undefined
    : inArray(workerTrainingAssignments.worksiteId, scope)
  const assignments = await db.select({
    courseId: workerTrainingAssignments.courseId,
    workerId: workerTrainingAssignments.workerId,
    expiresAt: workerTrainingAssignments.expiresAt,
  }).from(workerTrainingAssignments).where(assignmentWhere)

  const compliantByCourse = new Map<string, Set<string>>()
  for (const a of assignments) {
    if (a.expiresAt !== null && a.expiresAt < today) continue
    if (!compliantByCourse.has(a.courseId)) compliantByCourse.set(a.courseId, new Set())
    compliantByCourse.get(a.courseId)!.add(a.workerId)
  }

  const rows: TrainingMatrixRow[] = []
  for (const course of withCargo) {
    for (const cargo of course.requiredForCargo as string[]) {
      const requiredWorkers = workerRows.filter((w) => w.position === cargo)
      if (requiredWorkers.length === 0) continue
      const compliantSet = compliantByCourse.get(course.id) ?? new Set()
      const compliantCount = requiredWorkers.filter((w) => compliantSet.has(w.id)).length
      rows.push({
        courseId: course.id,
        courseName: course.name,
        cargo,
        requiredCount: requiredWorkers.length,
        compliantCount,
      })
    }
  }
  return rows
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `PGHOST=/var/run/postgresql npx vitest run lib/__tests__/prevention-training-matrix.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit -p .`
Expected: sin salida (0 errores).

- [ ] **Step 6: Commit**

```bash
git add lib/services/prevention-training.ts lib/__tests__/prevention-training-matrix.test.ts
git commit -m "feat(prevention): add getTrainingMatrix cargo x course coverage service"
```

### Task A2: Página `capacitaciones/matriz` + nav

**Files:**
- Create: `app/(app)/prevencion/capacitaciones/matriz/page.tsx`
- Create: `app/(app)/prevencion/capacitaciones/matriz/loading.tsx`
- Modify: `modules/prevention/manifest.ts` (agregar child al nav item "Capacitaciones")

**Interfaces:**
- Consumes: `getTrainingMatrix` (Task A1), `resolveWorksiteScope`, `requireAuth`/`can`, `todayLocalISO` de `@/lib/sst/date`.

- [ ] **Step 1: Crear la página**

Crear `app/(app)/prevencion/capacitaciones/matriz/page.tsx`:

```tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getTrainingMatrix } from "@/lib/services/prevention-training"
import { todayLocalISO } from "@/lib/sst/date"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = { title: "Matriz de capacitación por cargo" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function CapacitacionMatrizPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:training:view")) redirect("/forbidden")

  const rows = await getTrainingMatrix(scopeToIds(resolveWorksiteScope(session)), todayLocalISO())

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Capacitaciones", href: "/prevencion/capacitaciones" }, { label: "Matriz por cargo" }]} />
      <PageHeader title="Matriz de capacitación por cargo" description="Cobertura de cursos requeridos por cargo vs. trabajadores al día." />
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cargo</TableHead>
              <TableHead>Curso requerido</TableHead>
              <TableHead className="text-right">Requeridos</TableHead>
              <TableHead className="text-right">Al día</TableHead>
              <TableHead className="text-right">Cobertura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState compact title="Sin cursos por cargo" description="No hay cursos con cargos requeridos configurados en tu alcance." />
                </TableCell>
              </TableRow>
            ) : rows.map((r) => {
              const pct = r.requiredCount > 0 ? Math.round((r.compliantCount / r.requiredCount) * 100) : 0
              const variant = pct >= 100 ? "success" : pct >= 50 ? "warning" : "danger"
              return (
                <TableRow key={`${r.courseId}-${r.cargo}`}>
                  <TableCell className="font-medium">{r.cargo}</TableCell>
                  <TableCell>{r.courseName}</TableCell>
                  <TableCellNum>{r.requiredCount}</TableCellNum>
                  <TableCellNum>{r.compliantCount}</TableCellNum>
                  <TableCell className="text-right"><Badge variant={variant}>{pct}%</Badge></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
    </PageContainer>
  )
}
```

- [ ] **Step 2: Crear `loading.tsx`**

Crear `app/(app)/prevencion/capacitaciones/matriz/loading.tsx` copiando el patrón de `app/(app)/prevencion/capacitaciones/loading.tsx` pero con `title="Matriz de capacitación por cargo"` y el breadcrumb `[{ label: "Prevención", href: "/prevencion" }, { label: "Capacitaciones", href: "/prevencion/capacitaciones" }, { label: "Matriz por cargo" }]`.

- [ ] **Step 3: Agregar entrada de nav**

En `modules/prevention/manifest.ts`, localizar el nav item "Capacitaciones" (`href: "/prevencion/capacitaciones"`) y agregarle un `children` (mismo patrón que "Matriz EPP" → "Stock crítico"):

```ts
        {
          label: "Capacitaciones",
          href: "/prevencion/capacitaciones",
          iconName: "Certificate",
          permissions: ["prevention:training:view"],
          children: [
            { label: "Matriz por cargo", href: "/prevencion/capacitaciones/matriz", permissions: ["prevention:training:view"] },
          ],
        },
```

- [ ] **Step 4: Verificar build de tipos**

Run: `npx tsc --noEmit -p .`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/prevencion/capacitaciones/matriz" modules/prevention/manifest.ts
git commit -m "feat(prevention): add training matrix page and nav child"
```

---

## Feature B — SLA de notificación de incidente

Badge "SLA excedido" en la lista de incidentes cuando un accidente grave/fatal se registró (`createdAt`) demasiado tarde respecto al evento (`occurredAt`). Umbral es un knob de calibración (la normativa exige notificación inmediata para accidentes graves/fatales; 24h es un default operativo razonable).

### Task B1: Helper puro `incidentSlaBreached`

**Files:**
- Create: `lib/prevention/incident-sla.ts`
- Test: `lib/__tests__/prevention-incident-sla.test.ts` (crear)

**Interfaces:**
- Produces: `INCIDENT_SLA_HOURS: Record<string, number>` y
  `incidentSlaBreached(input: { type: string; severity: string; occurredAt: string; createdAt: string }): boolean`.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/__tests__/prevention-incident-sla.test.ts` (test unitario puro, sin PGlite):

```ts
import { describe, expect, it } from "vitest"
import { incidentSlaBreached } from "@/lib/prevention/incident-sla"

describe("incidentSlaBreached (Feature B)", () => {
  const base = { type: "accidente", severity: "grave" }

  it("marca excedido cuando un accidente grave se registra > 24h después del evento", () => {
    expect(incidentSlaBreached({
      ...base,
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-02T09:00:00.000Z", // 25h
    })).toBe(true)
  })

  it("no marca excedido dentro de las 24h", () => {
    expect(incidentSlaBreached({
      ...base,
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-01T20:00:00.000Z", // 12h
    })).toBe(false)
  })

  it("no aplica SLA a incidentes que no son accidentes", () => {
    expect(incidentSlaBreached({
      type: "incidente", severity: "grave",
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-10T08:00:00.000Z",
    })).toBe(false)
  })

  it("no aplica SLA a accidentes leves (sin umbral definido)", () => {
    expect(incidentSlaBreached({
      type: "accidente", severity: "leve",
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-10T08:00:00.000Z",
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run lib/__tests__/prevention-incident-sla.test.ts`
Expected: FAIL — no se puede importar `@/lib/prevention/incident-sla`.

- [ ] **Step 3: Implementar el helper**

Crear `lib/prevention/incident-sla.ts`:

```ts
// SLA de notificación de incidentes. Solo accidentes graves/fatales tienen un
// límite legal de notificación "inmediata"; 24h es el default operativo.
// ponytail: umbral fijo por severidad. Si la faena necesita SLAs distintos
// por tipo de faena/cliente, mover a config por worksite.
export const INCIDENT_SLA_HOURS: Record<string, number> = {
  grave: 24,
  fatal: 24,
}

export function incidentSlaBreached(input: {
  type: string
  severity: string
  occurredAt: string
  createdAt: string
}): boolean {
  if (input.type !== "accidente") return false
  const limitHours = INCIDENT_SLA_HOURS[input.severity]
  if (!limitHours) return false
  const elapsedMs = new Date(input.createdAt).getTime() - new Date(input.occurredAt).getTime()
  return elapsedMs > limitHours * 60 * 60 * 1000
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run lib/__tests__/prevention-incident-sla.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/incident-sla.ts lib/__tests__/prevention-incident-sla.test.ts
git commit -m "feat(prevention): add incident notification SLA helper"
```

### Task B2: Badge de SLA en `incident-list`

**Files:**
- Modify: `app/(app)/prevencion/incidentes/incident-list.tsx`

**Interfaces:**
- Consumes: `incidentSlaBreached` (Task B1). El componente ya recibe `incidents: IncidentRow[]` con `type`, `severity`, `occurredAt`, `createdAt` (todos presentes en `PreventionIncident`).

- [ ] **Step 1: Importar el helper**

En `app/(app)/prevencion/incidentes/incident-list.tsx`, agregar debajo del import de badges existente:

```tsx
import { incidentSlaBreached } from "@/lib/prevention/incident-sla"
```

- [ ] **Step 2: Renderizar el badge en la celda de fecha**

Localizar la celda que renderiza la fecha del evento (`{formatDateDisplay(i.occurredAt.slice(0, 10))}`, ~línea 109) y reemplazarla por:

```tsx
                <TableCell className="font-mono text-xs">
                  <span className="flex items-center gap-2">
                    {formatDateDisplay(i.occurredAt.slice(0, 10))}
                    {incidentSlaBreached(i) ? <Badge variant="danger">SLA excedido</Badge> : null}
                  </span>
                </TableCell>
```

(`Badge` ya está importado en este archivo.)

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit -p .`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/prevencion/incidentes/incident-list.tsx"
git commit -m "feat(prevention): show SLA-breach badge in incident list"
```

---

## Feature C — Alcotest: tablero de tasas + sugerencia de tests aleatorios

Estadísticas de resultados (total, positivos, negativos, tasa) por faena, y un helper que sugiere N trabajadores al azar del scope para testear (sin persistencia — solo una ayuda operativa; agregar tabla de programación si luego se necesita historial).

### Task C1: Servicio `getAlcoholTestStats` + `suggestRandomWorkersForTest`

**Files:**
- Modify: `lib/services/prevention-alcohol-tests.ts`
- Test: `lib/__tests__/prevention-alcohol-stats.test.ts` (crear)

**Interfaces:**
- Consumes: `db`, `alcoholTests`, `workers` de `@/db/schema`; tipo local `WorksiteScope`.
- Produces:
  `getAlcoholTestStats(scope: WorksiteScope): Promise<{ total: number; positive: number; negative: number; positiveRate: number | null; byWorksite: { worksiteId: string; total: number; positive: number }[] }>`
  y `suggestRandomWorkersForTest(worksiteId: string, scope: WorksiteScope, n: number): Promise<{ id: string; firstName: string; lastName: string; rut: string | null }[]>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/__tests__/prevention-alcohol-stats.test.ts`. Encabezado PGlite estándar (copiar de `lib/__tests__/prevention-ola2.test.ts`). En `beforeEach`: worksites `ws-1`, `ws-2`; user `user-1`; workers `w-1`..`w-5` (active, ws-1).

```ts
describe("alcohol test stats & random suggestion (Feature C)", () => {
  it("calcula totales y tasa de positivos global y por faena", async () => {
    const { registerAlcoholTest, getAlcoholTestStats } = await import("@/lib/services/prevention-alcohol-tests")

    await registerAlcoholTest({ worksiteId: "ws-1", shift: "dia", performedAt: "2026-07-01T08:00:00.000Z", result: "positivo" }, "user-1", ["ws-1"])
    await registerAlcoholTest({ worksiteId: "ws-1", shift: "dia", performedAt: "2026-07-01T09:00:00.000Z", result: "negativo" }, "user-1", ["ws-1"])
    await registerAlcoholTest({ worksiteId: "ws-1", shift: "dia", performedAt: "2026-07-01T10:00:00.000Z", result: "negativo" }, "user-1", ["ws-1"])

    const stats = await getAlcoholTestStats(["ws-1"])
    expect(stats.total).toBe(3)
    expect(stats.positive).toBe(1)
    expect(stats.negative).toBe(2)
    expect(stats.positiveRate).toBeCloseTo(1 / 3, 5)
    expect(stats.byWorksite.find((w) => w.worksiteId === "ws-1")!.positive).toBe(1)
  })

  it("positiveRate es null cuando no hay tests", async () => {
    const { getAlcoholTestStats } = await import("@/lib/services/prevention-alcohol-tests")
    const stats = await getAlcoholTestStats(["ws-1"])
    expect(stats.total).toBe(0)
    expect(stats.positiveRate).toBeNull()
  })

  it("sugiere hasta N trabajadores activos de la faena y respeta el scope", async () => {
    const { suggestRandomWorkersForTest } = await import("@/lib/services/prevention-alcohol-tests")
    const picked = await suggestRandomWorkersForTest("ws-1", ["ws-1"], 3)
    expect(picked).toHaveLength(3)
    expect(new Set(picked.map((p) => p.id)).size).toBe(3) // sin repetidos
    await expect(suggestRandomWorkersForTest("ws-2", ["ws-1"], 3)).rejects.toThrow(/sin acceso/i)
  })
})
```

> Nota: `alcoholTestSchema` debe aceptar el shape `{ worksiteId, shift, performedAt, result, testedWorkerId?, evidenceUrl? }`. Verificar en `lib/validation/prevention.ts` que `result` y `performedAt` existan; si el schema exige `testedWorkerId`, pasarlo como `"w-1"` en el test. Ajustar el test al schema real antes de correrlo.

- [ ] **Step 2: Correr el test y ver que falla**

Run: `PGHOST=/var/run/postgresql npx vitest run lib/__tests__/prevention-alcohol-stats.test.ts`
Expected: FAIL — `getAlcoholTestStats is not a function`.

- [ ] **Step 3: Implementar las funciones**

En `lib/services/prevention-alcohol-tests.ts`, asegurar imports `and`, `eq`, `inArray` de `drizzle-orm` y `workers` de `@/db/schema`. Agregar:

```ts
export async function getAlcoholTestStats(scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) {
    return { total: 0, positive: 0, negative: 0, positiveRate: null as number | null, byWorksite: [] }
  }
  const where = scope === "all" ? undefined : inArray(alcoholTests.worksiteId, scope)
  const rows = await db.select({ worksiteId: alcoholTests.worksiteId, result: alcoholTests.result }).from(alcoholTests).where(where)

  const total = rows.length
  const positive = rows.filter((r) => r.result === "positivo").length
  const negative = rows.filter((r) => r.result === "negativo").length

  const byWorksiteMap = new Map<string, { total: number; positive: number }>()
  for (const r of rows) {
    const agg = byWorksiteMap.get(r.worksiteId) ?? { total: 0, positive: 0 }
    agg.total += 1
    if (r.result === "positivo") agg.positive += 1
    byWorksiteMap.set(r.worksiteId, agg)
  }

  return {
    total,
    positive,
    negative,
    positiveRate: total > 0 ? positive / total : null,
    byWorksite: [...byWorksiteMap.entries()].map(([worksiteId, agg]) => ({ worksiteId, ...agg })),
  }
}

// ponytail: selección aleatoria en memoria (Fisher-Yates parcial). Suficiente para
// una faena; si el padrón crece a decenas de miles, mover a ORDER BY random() LIMIT n.
export async function suggestRandomWorkersForTest(worksiteId: string, scope: WorksiteScope, n: number) {
  assertWorksiteAccess(worksiteId, scope)
  const rows = await db.select({
    id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut,
  }).from(workers).where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))

  const shuffled = [...rows]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.slice(0, Math.max(0, n))
}
```

Verificar que `assertWorksiteAccess` exista en este archivo; si no, copiar el patrón estándar (`if (scope === "all") return; if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")`).

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `PGHOST=/var/run/postgresql npx vitest run lib/__tests__/prevention-alcohol-stats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verificar tipos y commit**

Run: `npx tsc --noEmit -p .` (esperar sin salida), luego:

```bash
git add lib/services/prevention-alcohol-tests.ts lib/__tests__/prevention-alcohol-stats.test.ts
git commit -m "feat(prevention): add alcohol test stats and random worker suggestion"
```

### Task C2: Tarjetas de tasas + sugerencia en `alcotest-panel`

**Files:**
- Modify: `app/(app)/prevencion/alcotest/page.tsx` (pasar stats al panel)
- Modify: `app/(app)/prevencion/alcotest/alcotest-panel.tsx` (renderizar tarjetas)
- Create: `app/(app)/prevencion/alcotest/actions.ts` — agregar `suggestRandomWorkersAction` (si el archivo ya existe, solo agregar la action)

**Interfaces:**
- Consumes: `getAlcoholTestStats`, `suggestRandomWorkersForTest` (Task C1).
- Produces: `suggestRandomWorkersAction(worksiteId: string, n: number): Promise<ActionState & { data?: { workers: {...}[] } }>`.

- [ ] **Step 1: Leer los archivos actuales**

Leer `app/(app)/prevencion/alcotest/page.tsx` y `alcotest-panel.tsx` y `actions.ts` completos para conocer las props y el shape actual del panel antes de modificar.

- [ ] **Step 2: Agregar la action de sugerencia**

En `app/(app)/prevencion/alcotest/actions.ts` agregar (respetando el `guardPermission` que ya usan las otras actions del archivo):

```ts
export async function suggestRandomWorkersAction(worksiteId: string, n: number): Promise<ActionState & { data?: { workers: { id: string; firstName: string; lastName: string; rut: string | null }[] } }> {
  const { session, error } = await guardPermission("prevention:alcohol_tests:manage")
  if (error) return error
  try {
    const workers = await suggestRandomWorkersForTest(worksiteId, scopeToIds(resolveWorksiteScope(session)), n)
    return { ok: true, data: { workers } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al sugerir trabajadores." }
  }
}
```

Agregar `suggestRandomWorkersForTest` al import de `@/lib/services/prevention-alcohol-tests` y verificar que `scopeToIds`/`resolveWorksiteScope`/`guardPermission`/`ActionState` ya estén importados (copiar del resto del archivo).

- [ ] **Step 3: Pasar stats a la página**

En `app/(app)/prevencion/alcotest/page.tsx`, importar `getAlcoholTestStats`, llamarlo dentro del `Promise.all` existente pasando el mismo `scope`, y pasar `stats={stats}` al `<AlcotestPanel>`.

- [ ] **Step 4: Renderizar tarjetas de tasas en el panel**

En `alcotest-panel.tsx`, agregar la prop `stats` a la interfaz de Props y, encima de la tabla existente, renderizar una grilla de tarjetas (mismo patrón visual que las tarjetas de `kpis-panel.tsx`):

```tsx
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Tests totales</p>
          <p className="text-h1 font-semibold">{stats.total}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Positivos</p>
          <p className="text-h1 font-semibold">{stats.positive}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Tasa de positivos</p>
          <p className="text-h1 font-semibold">{stats.positiveRate !== null ? `${(stats.positiveRate * 100).toFixed(1)}%` : "—"}</p>
        </div>
      </div>
```

(La sugerencia de trabajadores aleatorios es opcional en esta UI; si se agrega un botón, que llame a `suggestRandomWorkersAction` y muestre los nombres en un toast o lista temporal. No persistir.)

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit -p .`
Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/prevencion/alcotest"
git commit -m "feat(prevention): add alcohol test rate dashboard and random suggestion action"
```

---

## Feature D — Contratistas: scope real del selector de trabajadores

El picker de "trabajador a asociar" en `contratistas/page.tsx` hoy lista TODOS los trabajadores activos ignorando el scope de la sesión. Debe listar solo trabajadores de las faenas del usuario. (El control de acceso a faena más amplio del contratista sigue siendo una decisión pendiente — ver sección final.)

### Task D1: Scopear `availableWorkers` en la página de contratistas

**Files:**
- Modify: `app/(app)/prevencion/contratistas/page.tsx`
- Test: `lib/__tests__/prevention-contractors.test.ts` (agregar caso al servicio que respalde el scope)

**Interfaces:**
- Consumes: `resolveWorksiteScope`, `inArray`/`eq` de `drizzle-orm`, `workers` de `@/db/schema`.

- [ ] **Step 1: Leer la query actual**

Leer `app/(app)/prevencion/contratistas/page.tsx`. Localizar la query `availableWorkers` que hoy hace `db.select(...).from(workers).where(eq(workers.isActive, true))` sin scope.

- [ ] **Step 2: Escribir el ajuste de la query**

Reemplazar esa query por una que respete el scope de la sesión. Asegurar que `scopeToIds`/`resolveWorksiteScope` estén disponibles en el archivo (el patrón `scopeToIds` ya se usa en otras páginas del área; si no está, copiarlo). Nueva versión:

```tsx
  const scope = scopeToIds(resolveWorksiteScope(session))
  const availableWorkers = canManage
    ? (scope !== "all" && scope.length === 0
        ? []
        : await db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
            .from(workers)
            .where(scope === "all"
              ? eq(workers.isActive, true)
              : and(eq(workers.isActive, true), inArray(workers.worksiteId, scope)))
            .orderBy(workers.firstName))
    : []
```

Agregar `and` al import de `drizzle-orm` si falta.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit -p .`
Expected: sin salida.

- [ ] **Step 4: Correr los tests existentes de contratistas**

Run: `PGHOST=/var/run/postgresql npx vitest run lib/__tests__/prevention-contractors.test.ts`
Expected: PASS (los 3 tests existentes siguen verdes; el cambio es solo de página, no de servicio).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/prevencion/contratistas/page.tsx"
git commit -m "fix(prevention): scope contractor worker picker to session worksites"
```

---

## Feature E — QA: inventario de capturas cubre las rutas de prevención P3

`scripts/capture-all-routes.test.ts` falla porque el inventario `CAPTURE_ROUTES` en `scripts/capture-all-routes.ts` nunca incluyó las rutas de los submódulos P3. El test exige que cada page concreta del App Router tenga una entrada de captura. Es mecánico: agregar las entradas faltantes.

### Task E1: Agregar las rutas de prevención faltantes al inventario

**Files:**
- Modify: `scripts/capture-all-routes.ts`

**Interfaces:**
- Consumes: la estructura existente `CAPTURE_ROUTES: { slug: string; path: string; auth: boolean }[]` y el mapa `dynamicSamples` en el test.

- [ ] **Step 1: Confirmar qué rutas faltan**

Run: `npx vitest run scripts/capture-all-routes.test.ts 2>&1 | grep '"/prevencion'`
Expected: lista de paths con `-` (esperados y ausentes del inventario). Anotar cada uno.

- [ ] **Step 2: Agregar las entradas estáticas**

En `scripts/capture-all-routes.ts`, en el array donde ya están `prevencion` / `prevencion-nueva` / `prevencion-ppa`, agregar una entrada por cada page concreta faltante (todas `auth: true`):

```ts
  { slug: "prevencion-pdtp", path: "/prevencion/pdtp", auth: true },
  { slug: "prevencion-iper", path: "/prevencion/iper", auth: true },
  { slug: "prevencion-incidentes", path: "/prevencion/incidentes", auth: true },
  { slug: "prevencion-incidentes-detalle", path: "/prevencion/incidentes/inc-audit-1", auth: true },
  { slug: "prevencion-incidentes-procedimiento", path: "/prevencion/incidentes/inc-audit-1/procedimiento", auth: true },
  { slug: "prevencion-capacitaciones", path: "/prevencion/capacitaciones", auth: true },
  { slug: "prevencion-capacitaciones-matriz", path: "/prevencion/capacitaciones/matriz", auth: true },
  { slug: "prevencion-inspecciones", path: "/prevencion/inspecciones", auth: true },
  { slug: "prevencion-inspecciones-detalle", path: "/prevencion/inspecciones/insp-audit-1", auth: true },
  { slug: "prevencion-equipos-reportes", path: "/prevencion/equipos/reportes", auth: true },
  { slug: "prevencion-equipos-checklists", path: "/prevencion/equipos/checklists", auth: true },
  { slug: "prevencion-alcotest", path: "/prevencion/alcotest", auth: true },
  { slug: "prevencion-epp-matriz", path: "/prevencion/epp/matriz", auth: true },
  { slug: "prevencion-epp-stock", path: "/prevencion/epp/stock", auth: true },
  { slug: "prevencion-salud", path: "/prevencion/salud", auth: true },
  { slug: "prevencion-salud-protocolos", path: "/prevencion/salud/protocolos", auth: true },
  { slug: "prevencion-emergencias", path: "/prevencion/emergencias", auth: true },
  { slug: "prevencion-documentacion", path: "/prevencion/documentacion", auth: true },
  { slug: "prevencion-contratistas", path: "/prevencion/contratistas", auth: true },
  { slug: "prevencion-comites", path: "/prevencion/comites", auth: true },
  { slug: "prevencion-kpis", path: "/prevencion/kpis", auth: true },
  { slug: "prevencion-permisos", path: "/prevencion/permisos", auth: true },
```

> Ajustar la lista final EXACTAMENTE a lo que reporte el Step 1 (no agregar rutas que no existan como page; no omitir ninguna que el test reclame). Si el test reclama `/prevencion/capacitaciones/matriz` solo aparecerá tras implementar Feature A — coordinar el orden (implementar E después de A, o incluir la ruta solo si la page existe).

- [ ] **Step 3: Registrar los samples dinámicos**

En `scripts/capture-all-routes.test.ts`, agregar al mapa `dynamicSamples` las claves de rutas `[id]` de prevención que falten:

```ts
  "/prevencion/incidentes/[id]": "/prevencion/incidentes/inc-audit-1",
  "/prevencion/incidentes/[id]/procedimiento": "/prevencion/incidentes/inc-audit-1/procedimiento",
  "/prevencion/inspecciones/[id]": "/prevencion/inspecciones/insp-audit-1",
```

- [ ] **Step 4: Correr el test hasta verde**

Run: `npx vitest run scripts/capture-all-routes.test.ts`
Expected: PASS (2 tests). Si sigue rojo, comparar el diff del assertion con las entradas agregadas y corregir slugs/paths faltantes.

- [ ] **Step 5: Commit**

```bash
git add scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts
git commit -m "test(prevention): cover P3 submodule routes in capture inventory"
```

---

## Verificación final (después de todas las features)

- [ ] `npx tsc --noEmit -p .` → sin salida.
- [ ] `npm run lint` → 0 errores (los warnings preexistentes de unused-vars son aceptables; no introducir nuevos errores).
- [ ] `PGHOST=/var/run/postgresql npm test` → los tests nuevos pasan; el único fallo pendiente aceptable es `request-type-actions-rejection.test.ts` (bug preexistente de otro módulo, fuera de este plan). `capture-all-routes.test.ts` debe quedar en verde tras Feature E.
- [ ] `npm run db:generate` → "No schema changes" (este plan no agrega columnas).
- [ ] Actualizar `docs/auditoria/PLAN_PREVENCION.md` sección "Estado final": marcar como ✅ los ítems A–E y dejar solo los bloqueados en la lista de pendientes.

---

## Decisiones requeridas (fuera de alcance de este plan)

Estos 6 ítems NO tienen tareas porque requieren una decisión previa; sin ella, cualquier plan sería inventado. Para cada uno, la pregunta concreta a resolver:

1. **Índice de gravedad (IG) en KPIs** — ¿dónde se registran los "días perdidos" por accidente? Opciones: (a) columna `lostDays integer` en `prevention_incidents`; (b) tabla `incident_lost_days` con historial. Decidido esto, es 1 migración + extender `getIncidentFrequencyRate` con `IG = díasPerdidos × 1000 / HHT` + 1 tarjeta en `kpis-panel`.

2. **Badge de stock crítico EPP** — ¿`eppProductId` se linkea al inventario real de bodega (`products.sku` + movimientos) o el stock EPP se registra como entidad separada? Sin una fuente de "stock actual", `getCriticalStock` no puede comparar contra el umbral.

3. **Restricciones de salud en PPA** — ¿PPA tendrá una taxonomía de tareas/riesgos (p.ej. "altura", "confinado") por línea de servicio o por item? Y ¿el resultado es bloqueo duro o advertencia? Sin taxonomía de tareas no hay contra qué comparar `health_restrictions.kind`.

4. **Anomalía de equipos → ticket de mantención** — ¿`maintenance.ts` se generaliza para activos no-vehículo (polimorfismo `assetType`/`assetId` en `maintenance_records`) o se crea una tabla de tickets de mantención de equipos separada? Hoy `maintenanceRecords.vehicleId` es FK dura a `fuelVehicles`.

5. **DIAT automática desde incidente** — se necesita el formato/plantilla oficial exacto de la DIAT (Declaración Individual de Accidente del Trabajo) de la Dirección del Trabajo para generar el PDF y subirlo a `incident_statements`.

6. **P4 completo** (motor de recordatorios/vencimientos transversal, dashboard de prevención home, bitácora/change-log reutilizable) — cada uno merece su propio spec de brainstorming; son subsistemas, no tareas.

Nota aparte: **`request-type-actions-rejection.test.ts`** falla por un bug en el módulo de solicitudes/servicios (no prevención) — investigación separada, no forma parte de estos pendientes.
