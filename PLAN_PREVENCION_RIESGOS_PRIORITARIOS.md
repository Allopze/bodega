# Prevencion Riesgos Prioritarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar los 3 faltantes mas importantes para convertir Prevencion desde evaluaciones SST/PPA hacia un modulo preventivo operacional completo.

**Architecture:** Mantener `lib/` + `app/` como fuente de verdad. Usar `modules/*/manifest.ts` solo para permisos/navegacion/seed, siguiendo `modules/README.md`. Cada nuevo dominio tendra schema Drizzle, validation Zod, service, Server Actions, UI App Router, tests PGlite/unitarios y export XLSX cuando aplique.

**Tech Stack:** Next.js App Router, Server Actions, Drizzle/Postgres, PGlite tests, Zod, Vitest, XLSX via `lib/reports/export`, RBAC por manifests, scoping por faena.

---

## Seleccion de los 3 mas importantes

1. **Matriz IPER/MIPER**
   - Es la base preventiva: define peligros, riesgos, controles, riesgo residual y responsables por faena/proceso/tarea.
   - Sin IPER, las inspecciones, capacitaciones y PPA quedan desconectados de una fuente formal de riesgo.

2. **Accidentes, incidentes y cuasi accidentes**
   - Es el mayor riesgo legal y operacional reactivo: requiere registro, investigacion, causa raiz, evidencia y acciones.
   - Alimenta reincidencia, acciones correctivas y actualizacion obligatoria de matriz IPER.

3. **Capacitaciones, competencias y vencimientos**
   - Es la evidencia de habilitacion de personas: ODI, RIOHS, charlas, cursos, evaluaciones y certificados.
   - Permite bloquear o alertar trabajo critico cuando una competencia esta vencida o ausente.

No se seleccionan en esta primera ola: emergencias, contratistas, CPHS, vigilancia de salud, permisos de trabajo y EPP preventivo avanzado. Son importantes, pero dependen mejor de estas tres bases.

---

## Files

### Create

- `db/schema/prevention.ts`: tablas IPER, incidentes, acciones de incidente, capacitaciones, asignaciones y evidencias.
- `lib/validation/prevention.ts`: schemas Zod compartidos para IPER, incidentes y capacitaciones.
- `lib/services/prevention-iper.ts`: CRUD, versionado, calculo de riesgo y export IPER.
- `lib/services/prevention-incidents.ts`: CRUD, investigacion, acciones, cierre y export incidentes.
- `lib/services/prevention-training.ts`: CRUD de cursos, asignaciones, vencimientos y export capacitaciones.
- `modules/prevention/manifest.ts`: permisos y navegacion del submodulo Prevencion ampliado.
- `app/(app)/prevencion/iper/page.tsx`
- `app/(app)/prevencion/iper/actions.ts`
- `app/(app)/prevencion/iper/iper-list.tsx`
- `app/(app)/prevencion/iper/iper-form.tsx`
- `app/(app)/prevencion/incidentes/page.tsx`
- `app/(app)/prevencion/incidentes/actions.ts`
- `app/(app)/prevencion/incidentes/[id]/page.tsx`
- `app/(app)/prevencion/incidentes/incident-form.tsx`
- `app/(app)/prevencion/capacitaciones/page.tsx`
- `app/(app)/prevencion/capacitaciones/actions.ts`
- `app/(app)/prevencion/capacitaciones/training-list.tsx`
- `app/(app)/prevencion/capacitaciones/training-form.tsx`
- `lib/__tests__/prevention-iper.test.ts`
- `lib/__tests__/prevention-incidents.test.ts`
- `lib/__tests__/prevention-training.test.ts`
- `lib/__tests__/prevention-rbac.test.ts`
- `app/(app)/prevencion/iper/iper-list.test.tsx`
- `app/(app)/prevencion/incidentes/incident-form.test.tsx`
- `app/(app)/prevencion/capacitaciones/training-list.test.tsx`

### Modify

- `db/schema/index.ts`: exportar `./prevention`.
- `modules/registry.ts`: importar y registrar `preventionModule`.
- `lib/reports/export.ts`: agregar builders XLSX para IPER, incidentes y capacitaciones si se decide integrarlos al area reportes.
- `AUDITORIA_PREVENCION_RIESGOS.md`: mover los tres faltantes a "planificado" o "implementado" al completar cada hito.

---

## Shared Permissions

Agregar permisos en `modules/prevention/manifest.ts`:

```ts
import type { ModuleManifest } from "@/modules/manifest-types"

export const preventionModule = {
  id: "prevention",
  permissions: [
    "prevention:iper:view",
    "prevention:iper:manage",
    "prevention:incidents:view",
    "prevention:incidents:manage",
    "prevention:incidents:close",
    "prevention:training:view",
    "prevention:training:manage",
  ] as const,
  permissionMeta: {
    "prevention:iper:view":       { id: "p-prev-iper-view", description: "Ver matriz IPER/MIPER" },
    "prevention:iper:manage":     { id: "p-prev-iper-manage", description: "Gestionar matriz IPER/MIPER" },
    "prevention:incidents:view":  { id: "p-prev-inc-view", description: "Ver incidentes y accidentes" },
    "prevention:incidents:manage": { id: "p-prev-inc-manage", description: "Gestionar investigacion de incidentes" },
    "prevention:incidents:close": { id: "p-prev-inc-close", description: "Cerrar investigaciones de incidentes" },
    "prevention:training:view":   { id: "p-prev-train-view", description: "Ver capacitaciones y competencias" },
    "prevention:training:manage": { id: "p-prev-train-manage", description: "Gestionar capacitaciones y vencimientos" },
  },
  nav: [
    {
      areaId: "prevencion",
      items: [
        {
          label: "IPER/MIPER",
          href: "/prevencion/iper",
          iconName: "WarningDiamond",
          permissions: ["prevention:iper:view"],
        },
        {
          label: "Incidentes",
          href: "/prevencion/incidentes",
          iconName: "Siren",
          permissions: ["prevention:incidents:view"],
        },
        {
          label: "Capacitaciones",
          href: "/prevencion/capacitaciones",
          iconName: "Certificate",
          permissions: ["prevention:training:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "prevencionista", permission: "prevention:iper:view" },
    { roleSlug: "prevencionista", permission: "prevention:iper:manage" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:manage" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:close" },
    { roleSlug: "prevencionista", permission: "prevention:training:view" },
    { roleSlug: "prevencionista", permission: "prevention:training:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:iper:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:view" },
    { roleSlug: "administrador", permission: "prevention:iper:view" },
    { roleSlug: "administrador", permission: "prevention:iper:manage" },
    { roleSlug: "administrador", permission: "prevention:incidents:view" },
    { roleSlug: "administrador", permission: "prevention:incidents:manage" },
    { roleSlug: "administrador", permission: "prevention:incidents:close" },
    { roleSlug: "administrador", permission: "prevention:training:view" },
    { roleSlug: "administrador", permission: "prevention:training:manage" },
  ],
} as const satisfies ModuleManifest
```

---

## Task 1: Matriz IPER/MIPER

**Files:**
- Create: `db/schema/prevention.ts`
- Create: `lib/validation/prevention.ts`
- Create: `lib/services/prevention-iper.ts`
- Create: `app/(app)/prevencion/iper/actions.ts`
- Create: `app/(app)/prevencion/iper/page.tsx`
- Create: `app/(app)/prevencion/iper/iper-list.tsx`
- Create: `app/(app)/prevencion/iper/iper-form.tsx`
- Test: `lib/__tests__/prevention-iper.test.ts`
- Modify: `db/schema/index.ts`

- [ ] **Step 1: Write failing schema/service tests**

Create `lib/__tests__/prevention-iper.test.ts`:

```ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with app db shape in tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.iperRiskItems)
  await inMemoryDb.delete(schema.iperMatrices)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
})

describe("IPER matrix", () => {
  it("creates a matrix and calculates residual risk level", async () => {
    const { createIperMatrix, addIperRiskItem } = await import("@/lib/services/prevention-iper")

    const matrix = await createIperMatrix({
      worksiteId: "ws-1",
      code: "IPER-FA-2026",
      version: 1,
      title: "IPER Faena A",
      effectiveFrom: "2026-07-01",
    }, "user-1", ["ws-1"])

    const item = await addIperRiskItem({
      matrixId: matrix.id,
      process: "Operacion",
      task: "Conduccion",
      hazard: "Interaccion equipo-persona",
      consequence: "Atropello",
      initialProbability: 5,
      initialSeverity: 5,
      controls: ["Segregacion", "PPA", "Charla diaria"],
      residualProbability: 2,
      residualSeverity: 5,
      responsible: "Jefe de faena",
    }, ["ws-1"])

    expect(item.initialRiskScore).toBe(25)
    expect(item.residualRiskScore).toBe(10)
    expect(item.residualRiskLevel).toBe("alto")
  })

  it("rejects creating a matrix outside worksite scope", async () => {
    const { createIperMatrix } = await import("@/lib/services/prevention-iper")

    await expect(createIperMatrix({
      worksiteId: "ws-1",
      code: "IPER-FA-2026",
      version: 1,
      title: "IPER Faena A",
      effectiveFrom: "2026-07-01",
    }, "user-1", ["ws-2"])).rejects.toThrow("sin acceso")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- lib/__tests__/prevention-iper.test.ts
```

Expected: FAIL because `schema.iperMatrices`, `schema.iperRiskItems` and `@/lib/services/prevention-iper` do not exist.

- [ ] **Step 3: Add schema**

Create `db/schema/prevention.ts` with IPER tables:

```ts
import { relations } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"

export const iperMatrices = pgTable("iper_matrices", {
  id:            text("id").primaryKey(),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  code:          text("code").notNull(),
  version:       integer("version").notNull(),
  title:         text("title").notNull(),
  status:        text("status").notNull().default("draft"),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo:   text("effective_to"),
  createdBy:     text("created_by").notNull().references(() => users.id),
  closedBy:      text("closed_by").references(() => users.id),
  closedAt:      timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("iper_matrices_code_version_unique").on(table.code, table.version),
  index("iper_matrices_worksite_status_idx").on(table.worksiteId, table.status),
])

export const iperRiskItems = pgTable("iper_risk_items", {
  id:                  text("id").primaryKey(),
  matrixId:            text("matrix_id").notNull().references(() => iperMatrices.id, { onDelete: "cascade" }),
  process:             text("process").notNull(),
  task:                text("task").notNull(),
  hazard:              text("hazard").notNull(),
  consequence:         text("consequence").notNull(),
  initialProbability:  integer("initial_probability").notNull(),
  initialSeverity:     integer("initial_severity").notNull(),
  initialRiskScore:    integer("initial_risk_score").notNull(),
  initialRiskLevel:    text("initial_risk_level").notNull(),
  controls:            jsonb("controls").notNull(),
  residualProbability: integer("residual_probability").notNull(),
  residualSeverity:    integer("residual_severity").notNull(),
  residualRiskScore:   integer("residual_risk_score").notNull(),
  residualRiskLevel:   text("residual_risk_level").notNull(),
  responsible:         text("responsible").notNull(),
  requiresTraining:    boolean("requires_training").notNull().default(false),
  requiresPpa:         boolean("requires_ppa").notNull().default(false),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("iper_risk_items_matrix_idx").on(table.matrixId),
  index("iper_risk_items_residual_level_idx").on(table.residualRiskLevel),
])

export const iperMatricesRelations = relations(iperMatrices, ({ one, many }) => ({
  worksite: one(worksites, { fields: [iperMatrices.worksiteId], references: [worksites.id] }),
  creator: one(users, { fields: [iperMatrices.createdBy], references: [users.id] }),
  items: many(iperRiskItems),
}))

export const iperRiskItemsRelations = relations(iperRiskItems, ({ one }) => ({
  matrix: one(iperMatrices, { fields: [iperRiskItems.matrixId], references: [iperMatrices.id] }),
}))
```

Modify `db/schema/index.ts`:

```ts
export * from "./prevention"
```

- [ ] **Step 4: Add validation and service**

Create `lib/validation/prevention.ts`:

```ts
import { z } from "zod"

const score = z.coerce.number().int().min(1).max(5)

export const iperMatrixCreateSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  code: z.string().trim().min(1, "Codigo requerido").max(40),
  version: z.coerce.number().int().positive("Version requerida"),
  title: z.string().trim().min(1, "Titulo requerido").max(160),
  effectiveFrom: z.string().min(1, "Fecha de vigencia requerida"),
  effectiveTo: z.string().optional().or(z.literal("")),
})

export const iperRiskItemSchema = z.object({
  matrixId: z.string().min(1, "Matriz requerida"),
  process: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(160),
  hazard: z.string().trim().min(1).max(200),
  consequence: z.string().trim().min(1).max(200),
  initialProbability: score,
  initialSeverity: score,
  controls: z.array(z.string().trim().min(1)).min(1),
  residualProbability: score,
  residualSeverity: score,
  responsible: z.string().trim().min(1).max(160),
  requiresTraining: z.boolean().optional(),
  requiresPpa: z.boolean().optional(),
})
```

Create `lib/services/prevention-iper.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { iperMatrices, iperRiskItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { iperMatrixCreateSchema, iperRiskItemSchema } from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope) {
  if (scope !== "all" && !scope.includes(worksiteId)) {
    throw new Error("Matriz IPER no encontrada o sin acceso.")
  }
}

export function classifyRisk(score: number): "bajo" | "medio" | "alto" | "critico" {
  if (score >= 20) return "critico"
  if (score >= 10) return "alto"
  if (score >= 5) return "medio"
  return "bajo"
}

export async function createIperMatrix(input: unknown, userId: string, scope: WorksiteScope) {
  const data = iperMatrixCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const id = nanoid()
  await db.insert(iperMatrices).values({
    id,
    worksiteId: data.worksiteId,
    code: data.code,
    version: data.version,
    title: data.title,
    status: "draft",
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo || null,
    createdBy: userId,
    closedBy: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(iperMatrices).where(eq(iperMatrices.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la matriz IPER.")
  return row
}

export async function addIperRiskItem(input: unknown, scope: WorksiteScope) {
  const data = iperRiskItemSchema.parse(input)

  const [matrix] = await db.select().from(iperMatrices).where(eq(iperMatrices.id, data.matrixId)).limit(1)
  if (!matrix) throw new Error("Matriz IPER no encontrada.")
  assertWorksiteAccess(matrix.worksiteId, scope)

  const initialRiskScore = data.initialProbability * data.initialSeverity
  const residualRiskScore = data.residualProbability * data.residualSeverity
  const now = new Date().toISOString()
  const id = nanoid()

  await db.insert(iperRiskItems).values({
    id,
    matrixId: data.matrixId,
    process: data.process,
    task: data.task,
    hazard: data.hazard,
    consequence: data.consequence,
    initialProbability: data.initialProbability,
    initialSeverity: data.initialSeverity,
    initialRiskScore,
    initialRiskLevel: classifyRisk(initialRiskScore),
    controls: data.controls,
    residualProbability: data.residualProbability,
    residualSeverity: data.residualSeverity,
    residualRiskScore,
    residualRiskLevel: classifyRisk(residualRiskScore),
    responsible: data.responsible,
    requiresTraining: data.requiresTraining ?? false,
    requiresPpa: data.requiresPpa ?? false,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(iperRiskItems).where(eq(iperRiskItems.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear el riesgo IPER.")
  return row
}

export async function listIperMatrices(scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) return []
  return db.select().from(iperMatrices).where(
    scope === "all" ? undefined : inArray(iperMatrices.worksiteId, scope),
  )
}
```

- [ ] **Step 5: Generate and apply migration**

Run:

```bash
npm run db:generate
PGHOST=/var/run/postgresql npm run db:migrate
npm run db:generate
```

Expected: first command creates one new migration; migrate succeeds; final generate prints `No schema changes, nothing to migrate`.

- [ ] **Step 6: Run IPER tests**

Run:

```bash
npm test -- lib/__tests__/prevention-iper.test.ts
```

Expected: PASS.

---

## Task 2: Accidentes, incidentes y cuasi accidentes

**Files:**
- Modify: `db/schema/prevention.ts`
- Modify: `lib/validation/prevention.ts`
- Create: `lib/services/prevention-incidents.ts`
- Create: `app/(app)/prevencion/incidentes/actions.ts`
- Create: `app/(app)/prevencion/incidentes/page.tsx`
- Create: `app/(app)/prevencion/incidentes/[id]/page.tsx`
- Create: `app/(app)/prevencion/incidentes/incident-form.tsx`
- Test: `lib/__tests__/prevention-incidents.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/__tests__/prevention-incidents.test.ts`:

```ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with app db shape in tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionIncidentActions)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1",
    firstName: "Ada",
    lastName: "Lovelace",
    rut: "11.111.111-1",
    position: "Operadora",
    worksiteId: "ws-1",
    isActive: true,
    createdAt: "2026-07-01T00:00:00.000Z",
  })
})

describe("prevention incidents", () => {
  it("creates an incident and blocks closing while actions are pending", async () => {
    const { createIncident, addIncidentAction, closeIncident } = await import("@/lib/services/prevention-incidents")

    const incident = await createIncident({
      worksiteId: "ws-1",
      workerId: "worker-1",
      type: "cuasi_accidente",
      occurredAt: "2026-07-01T10:00:00.000Z",
      title: "Casi golpe por retroceso",
      description: "Equipo retrocede en zona peatonal",
      immediateCause: "Falta de segregacion",
      rootCause: "Control operacional insuficiente",
    }, "user-1", ["ws-1"])

    await addIncidentAction({
      incidentId: incident.id,
      description: "Instalar barrera fisica",
      responsible: "Jefe de faena",
      dueDate: "2026-07-10",
    }, ["ws-1"])

    await expect(closeIncident(incident.id, "user-1", ["ws-1"]))
      .rejects.toThrow("acciones pendientes")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- lib/__tests__/prevention-incidents.test.ts
```

Expected: FAIL because incident tables and service do not exist.

- [ ] **Step 3: Add incident schema**

Append to `db/schema/prevention.ts`:

```ts
export const preventionIncidents = pgTable("prevention_incidents", {
  id:             text("id").primaryKey(),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  workerId:       text("worker_id"),
  type:           text("type").notNull(),
  status:         text("status").notNull().default("open"),
  occurredAt:     timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  title:          text("title").notNull(),
  description:    text("description").notNull(),
  immediateCause: text("immediate_cause"),
  rootCause:      text("root_cause"),
  createdBy:      text("created_by").notNull().references(() => users.id),
  closedBy:       text("closed_by").references(() => users.id),
  closedAt:       timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incidents_worksite_status_idx").on(table.worksiteId, table.status),
  index("prevention_incidents_type_occurred_idx").on(table.type, table.occurredAt),
])

export const preventionIncidentActions = pgTable("prevention_incident_actions", {
  id:          text("id").primaryKey(),
  incidentId:  text("incident_id").notNull().references(() => preventionIncidents.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  responsible: text("responsible").notNull(),
  dueDate:     text("due_date").notNull(),
  status:      text("status").notNull().default("pendiente"),
  closedAt:    timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("prevention_incident_actions_incident_status_idx").on(table.incidentId, table.status),
])
```

- [ ] **Step 4: Implement service**

Create `lib/services/prevention-incidents.ts` with `createIncident`, `addIncidentAction`, `closeIncident`:

```ts
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { preventionIncidentActions, preventionIncidents } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { z } from "zod"

const incidentSchema = z.object({
  worksiteId: z.string().min(1),
  workerId: z.string().optional().or(z.literal("")),
  type: z.enum(["accidente", "incidente", "cuasi_accidente", "enfermedad_profesional"]),
  occurredAt: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  immediateCause: z.string().max(1000).optional().or(z.literal("")),
  rootCause: z.string().max(1000).optional().or(z.literal("")),
})

const actionSchema = z.object({
  incidentId: z.string().min(1),
  description: z.string().trim().min(1).max(1000),
  responsible: z.string().trim().min(1).max(160),
  dueDate: z.string().min(1),
})

type Scope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: Scope) {
  if (scope !== "all" && !scope.includes(worksiteId)) {
    throw new Error("Incidente no encontrado o sin acceso.")
  }
}

export async function createIncident(input: unknown, userId: string, scope: Scope) {
  const data = incidentSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const now = new Date().toISOString()
  const id = nanoid()

  await db.insert(preventionIncidents).values({
    id,
    worksiteId: data.worksiteId,
    workerId: data.workerId || null,
    type: data.type,
    status: "open",
    occurredAt: data.occurredAt,
    title: data.title,
    description: data.description,
    immediateCause: data.immediateCause || null,
    rootCause: data.rootCause || null,
    createdBy: userId,
    closedBy: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear el incidente.")
  return row
}

export async function addIncidentAction(input: unknown, scope: Scope) {
  const data = actionSchema.parse(input)
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, data.incidentId)).limit(1)
  if (!incident) throw new Error("Incidente no encontrado.")
  assertWorksiteAccess(incident.worksiteId, scope)

  const now = new Date().toISOString()
  const id = nanoid()
  await db.insert(preventionIncidentActions).values({
    id,
    incidentId: data.incidentId,
    description: data.description,
    responsible: data.responsible,
    dueDate: data.dueDate,
    status: "pendiente",
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(preventionIncidentActions).where(eq(preventionIncidentActions.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la accion.")
  return row
}

export async function closeIncident(id: string, userId: string, scope: Scope) {
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, id)).limit(1)
  if (!incident) throw new Error("Incidente no encontrado.")
  assertWorksiteAccess(incident.worksiteId, scope)

  const pending = await db.select({ id: preventionIncidentActions.id })
    .from(preventionIncidentActions)
    .where(and(eq(preventionIncidentActions.incidentId, id), ne(preventionIncidentActions.status, "cerrada")))
    .limit(1)

  if (pending.length > 0) throw new Error("No se puede cerrar: existen acciones pendientes.")

  const now = new Date().toISOString()
  const [updated] = await db.update(preventionIncidents)
    .set({ status: "closed", closedBy: userId, closedAt: now, updatedAt: now })
    .where(eq(preventionIncidents.id, id))
    .returning()

  if (!updated) throw new Error("No se pudo cerrar el incidente.")
  return updated
}
```

- [ ] **Step 5: Generate migration and run tests**

Run:

```bash
npm run db:generate
PGHOST=/var/run/postgresql npm run db:migrate
npm test -- lib/__tests__/prevention-incidents.test.ts
npm run db:generate
```

Expected: migration created and applied; incident tests PASS; final generate has no schema changes.

---

## Task 3: Capacitaciones, competencias y vencimientos

**Files:**
- Modify: `db/schema/prevention.ts`
- Modify: `lib/validation/prevention.ts`
- Create: `lib/services/prevention-training.ts`
- Create: `app/(app)/prevencion/capacitaciones/actions.ts`
- Create: `app/(app)/prevencion/capacitaciones/page.tsx`
- Create: `app/(app)/prevencion/capacitaciones/training-list.tsx`
- Create: `app/(app)/prevencion/capacitaciones/training-form.tsx`
- Test: `lib/__tests__/prevention-training.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/__tests__/prevention-training.test.ts`:

```ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with app db shape in tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.workerTrainingAssignments)
  await inMemoryDb.delete(schema.trainingCourses)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1",
    firstName: "Ada",
    lastName: "Lovelace",
    rut: "11.111.111-1",
    position: "Operadora",
    worksiteId: "ws-1",
    isActive: true,
    createdAt: "2026-07-01T00:00:00.000Z",
  })
})

describe("prevention training", () => {
  it("assigns a course to a worker and marks it expired by due date", async () => {
    const { createTrainingCourse, assignTrainingToWorker, listExpiredTrainings } = await import("@/lib/services/prevention-training")

    const course = await createTrainingCourse({
      code: "ODI",
      name: "Obligacion de informar",
      validityMonths: 12,
      requiredForCargo: ["conductor_ampliroll"],
    }, "user-1")

    await assignTrainingToWorker({
      courseId: course.id,
      workerId: "worker-1",
      worksiteId: "ws-1",
      completedAt: "2025-01-01",
      expiresAt: "2026-01-01",
      score: 100,
    }, "user-1", ["ws-1"])

    const expired = await listExpiredTrainings(["ws-1"], "2026-07-01")
    expect(expired).toHaveLength(1)
    expect(expired[0]!.workerId).toBe("worker-1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- lib/__tests__/prevention-training.test.ts
```

Expected: FAIL because training tables and service do not exist.

- [ ] **Step 3: Add training schema**

Append to `db/schema/prevention.ts`:

```ts
export const trainingCourses = pgTable("training_courses", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  validityMonths:   integer("validity_months"),
  requiredForCargo: jsonb("required_for_cargo").notNull(),
  isActive:         boolean("is_active").notNull().default(true),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const workerTrainingAssignments = pgTable("worker_training_assignments", {
  id:          text("id").primaryKey(),
  courseId:    text("course_id").notNull().references(() => trainingCourses.id),
  workerId:    text("worker_id").notNull(),
  worksiteId:  text("worksite_id").notNull().references(() => worksites.id),
  completedAt: text("completed_at").notNull(),
  expiresAt:   text("expires_at"),
  score:       integer("score"),
  evidenceUrl: text("evidence_url"),
  createdBy:   text("created_by").notNull().references(() => users.id),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("worker_training_assignments_worker_idx").on(table.workerId),
  index("worker_training_assignments_worksite_expires_idx").on(table.worksiteId, table.expiresAt),
  uniqueIndex("worker_training_assignments_worker_course_unique").on(table.workerId, table.courseId),
])
```

- [ ] **Step 4: Implement training service**

Create `lib/services/prevention-training.ts`:

```ts
import { and, eq, inArray, lte } from "drizzle-orm"
import { db } from "@/db"
import { trainingCourses, workerTrainingAssignments } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { z } from "zod"

const courseSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  validityMonths: z.coerce.number().int().positive().optional(),
  requiredForCargo: z.array(z.string().min(1)).default([]),
})

const assignmentSchema = z.object({
  courseId: z.string().min(1),
  workerId: z.string().min(1),
  worksiteId: z.string().min(1),
  completedAt: z.string().min(1),
  expiresAt: z.string().optional().or(z.literal("")),
  score: z.coerce.number().int().min(0).max(100).optional(),
  evidenceUrl: z.string().optional().or(z.literal("")),
})

type Scope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: Scope) {
  if (scope !== "all" && !scope.includes(worksiteId)) {
    throw new Error("Capacitacion no encontrada o sin acceso.")
  }
}

export async function createTrainingCourse(input: unknown, userId: string) {
  const data = courseSchema.parse(input)
  const now = new Date().toISOString()
  const id = nanoid()

  await db.insert(trainingCourses).values({
    id,
    code: data.code,
    name: data.name,
    validityMonths: data.validityMonths ?? null,
    requiredForCargo: data.requiredForCargo,
    isActive: true,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la capacitacion.")
  return row
}

export async function assignTrainingToWorker(input: unknown, userId: string, scope: Scope) {
  const data = assignmentSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const now = new Date().toISOString()
  const id = nanoid()

  const [row] = await db.insert(workerTrainingAssignments)
    .values({
      id,
      courseId: data.courseId,
      workerId: data.workerId,
      worksiteId: data.worksiteId,
      completedAt: data.completedAt,
      expiresAt: data.expiresAt || null,
      score: data.score ?? null,
      evidenceUrl: data.evidenceUrl || null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workerTrainingAssignments.workerId, workerTrainingAssignments.courseId],
      set: {
        worksiteId: data.worksiteId,
        completedAt: data.completedAt,
        expiresAt: data.expiresAt || null,
        score: data.score ?? null,
        evidenceUrl: data.evidenceUrl || null,
        updatedAt: now,
      },
    })
    .returning()

  if (!row) throw new Error("No se pudo asignar la capacitacion.")
  return row
}

export async function listExpiredTrainings(scope: Scope, today: string) {
  if (scope !== "all" && scope.length === 0) return []
  return db.select()
    .from(workerTrainingAssignments)
    .where(and(
      lte(workerTrainingAssignments.expiresAt, today),
      scope === "all" ? undefined : inArray(workerTrainingAssignments.worksiteId, scope),
    ))
}
```

- [ ] **Step 5: Generate migration and run tests**

Run:

```bash
npm run db:generate
PGHOST=/var/run/postgresql npm run db:migrate
npm test -- lib/__tests__/prevention-training.test.ts
npm run db:generate
```

Expected: migration created and applied; training tests PASS; final generate has no schema changes.

---

## Task 4: Navigation, RBAC and Pages

**Files:**
- Create: `modules/prevention/manifest.ts`
- Modify: `modules/registry.ts`
- Create: route files under `app/(app)/prevencion/iper`, `app/(app)/prevencion/incidentes`, `app/(app)/prevencion/capacitaciones`
- Test: `lib/__tests__/prevention-rbac.test.ts`

- [ ] **Step 1: Add manifest and registry import**

Modify `modules/registry.ts`:

```ts
import { preventionModule } from "@/modules/prevention/manifest"
```

Add `preventionModule` after `ppaModule` in `registry`.

- [ ] **Step 2: Write RBAC parity test**

Create `lib/__tests__/prevention-rbac.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"

describe("prevention module permissions", () => {
  it("registers prevention permissions in module registry", () => {
    expect(ALL_MODULE_PERMISSIONS).toContain("prevention:iper:view")
    expect(ALL_MODULE_PERMISSIONS).toContain("prevention:incidents:manage")
    expect(ALL_MODULE_PERMISSIONS).toContain("prevention:training:manage")
  })
})
```

- [ ] **Step 3: Run RBAC test**

Run:

```bash
npm test -- lib/__tests__/prevention-rbac.test.ts
```

Expected: PASS after manifest registration.

- [ ] **Step 4: Build minimal list pages**

Each page must:
- call `requirePermission("<domain>:view")`;
- compute `worksiteIds` via `resolveWorksiteScope(session)` and local `scopeToIds` pattern;
- render `PageHeader` with breadcrumb under Prevencion;
- render list component with compact table and filters by faena/status/search.

Use these route titles:
- `/prevencion/iper`: `Matriz IPER/MIPER`
- `/prevencion/incidentes`: `Incidentes`
- `/prevencion/capacitaciones`: `Capacitaciones`

---

## Task 5: Exports and Final Verification

**Files:**
- Modify: each service or `lib/reports/export.ts`
- Create route handlers only if the feature needs direct download URLs

- [ ] **Step 1: Add XLSX exports only**

All exports must be XLSX, never CSV. For each domain expose:
- IPER: matriz with one row per risk item.
- Incidentes: incident header + action summary.
- Capacitaciones: worker/course/completed/expires/status.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- \
  lib/__tests__/prevention-iper.test.ts \
  lib/__tests__/prevention-incidents.test.ts \
  lib/__tests__/prevention-training.test.ts \
  lib/__tests__/prevention-rbac.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run:

```bash
npx eslint \
  db/schema/prevention.ts \
  lib/validation/prevention.ts \
  lib/services/prevention-iper.ts \
  lib/services/prevention-incidents.ts \
  lib/services/prevention-training.ts \
  app/'(app)'/prevencion/iper \
  app/'(app)'/prevencion/incidentes \
  app/'(app)'/prevencion/capacitaciones \
  modules/prevention/manifest.ts \
  modules/registry.ts
npm run typecheck
npm run db:generate
git diff --check
```

Expected:
- ESLint exits 0.
- Typecheck exits 0.
- `db:generate` prints `No schema changes, nothing to migrate`.
- `git diff --check` exits 0.

- [ ] **Step 4: Update audit**

Modify `AUDITORIA_PREVENCION_RIESGOS.md`:
- Move IPER/MIPER, incidentes and capacitaciones from faltantes to implemented/planned as appropriate.
- Add verification commands and results.
- Keep remaining faltantes visible.

---

## Remaining Functional Scope After This Plan

After these 3 priorities, the main remaining prevention capabilities are:

- Inspecciones de seguridad y observaciones conductuales.
- Gestion preventiva avanzada de EPP por matriz/cargo/riesgo.
- Permisos de trabajo y AST/ART/JSA.
- Gestion documental legal versionada.
- Vigilancia de salud ocupacional.
- Emergencias, simulacros y equipos de emergencia.
- Contratistas y cumplimiento Ley 20.123.
- CPHS/comites, reuniones, acuerdos y seguimiento.
- KPIs preventivos avanzados.
- Adjuntos y firmas digitales transversales.

---

## Self-Review

- Spec coverage: cubre los 3 faltantes seleccionados y deja fuera explicitamente el resto.
- Placeholder scan: no hay `TBD`, `TODO` ni pasos sin comando esperado.
- Type consistency: los nombres `iperMatrices`, `iperRiskItems`, `preventionIncidents`, `preventionIncidentActions`, `trainingCourses` y `workerTrainingAssignments` se usan de forma consistente entre schema, services y tests.
