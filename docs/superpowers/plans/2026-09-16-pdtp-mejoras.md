# Plan de implementación y mejora del PDTP (Programa de Trabajo Preventivo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar las brechas G1–G7 del informe comparativo, consolidar la corrección P1 en curso, exponer las "actividades en cero" sin cambiar la fórmula de cumplimiento y dejar la suite E2E como gate reproducible.

**Architecture:** El PDTP ya modela la actividad como contrato de cumplimiento acreditado desde otros submódulos. Este plan **no** reemplaza ese modelo: agrega (a) una entidad `objetivo`, (b) un exportador RE-36 con modelo de documento puro + renderer ExcelJS, (c) presets de recurrencia y aplicación masiva sobre `projectRecurrenceToLegacySchedule` (fuente única), (d) desvíos por celda en tabla operacional propia fuera de la huella firmada, (e) cierres mensuales con snapshot JSON re-renderizable y distribución por notificación/correo, (f) asignación nominal por faena, (g) E2E verde dos veces seguidas.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Postgres (migraciones con `drizzle-kit generate`), Zod, ExcelJS 4.4, vitest (`test:fast` + `test:pglite`), Playwright, Resend vía `lib/email/smtp.ts`.

**Spec:** `PDTP_COMPARATIVA_EXCEL_VS_MODULO_2026-09-16.md` (§5 brechas, §6.3 regla, §8 recomendaciones) y `PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md` (§2 layout RE-36, §5.4 reglas). QA: `qa/reports/2026-09-16-pdtp-uiux.md`.

## Contexto

El informe comparativo concluyó que el módulo actual supera al Excel en modelo y reglas, pero deja cinco brechas que importan a mandante, auditores y jefatura (export RE-36, presets, "no realizada con motivo", cierre de mes, asignación nominal), dos brechas menores (objetivos como entidad, correo del cierre), una regla de compensación mensual que conviene exponer, dos P1 del QA de hoy cuya corrección está a medio hacer en el árbol de trabajo, y una suite E2E que está a dos fallos de ser gate. Este plan ordena ese trabajo por dependencia y valor.

## Global Constraints

- Nunca editar a mano `db/migrations/meta/_journal.json` ni un `.sql` ya generado: cambiar `db/schema/**/*.ts` → `npm run db:generate` → `npm run db:migrate` → `npm run db:verify-migrations` (`db/migrations/README.md:29`).
- Todo test PGlite nuevo se registra en el array de `tests/pglite-files.ts` (si no, `test:fast` lo ejecuta sin BD y falla).
- Todo permiso nuevo se declara en `modules/prevention/manifest.ts` con `defaultGrants` **y** se actualiza el conteo en `ARCHITECTURE.md` (si no, `lib/__tests__/architecture-doc-rbac.test.ts` falla).
- Lo que entra en la huella firmada (`lib/services/pdtp/content-digest.ts`, `schemaVersion`) es contenido del documento: objetivos **sí**; desvíos, cierres y asignados **no**.
- `loadProgramScheduleAndExecutions` (`lib/services/pdtp/helpers.ts:176`) es la única costura donde se transforman P/E por faena: overrides, exclusiones y (nuevo) desvíos se aplican ahí y en ningún otro sitio.
- No cambiar la fórmula de cumplimiento (`lib/services/pdtp/compliance.ts:345`): solo agregar métricas.
- Copy de UI en español claro, sin IDs internos ni enums crudos (PRODUCT.md). Fechas/meses en hora de Chile (`chileDateParts`).
- Cada tarea termina con `npm run typecheck && npm run lint` y las suites indicadas, y con un commit propio.
- Ids: prefijo `pdtp-<entidad>-` + `nanoid()` como en `lib/services/pdtp/executors.ts`.

---

## Fase 0 — Consolidar y verificar la corrección P1 en curso

**Objetivo:** dejar `main` con la corrección de los dos P1 del QA commiteada y verificada, separada del trabajo ajeno que hoy comparte el árbol.

### Task 0.1: Separar el árbol de trabajo en commits independientes

**Files:**
- Ninguno nuevo. Afecta lo ya modificado: `app/(app)/prevencion/pdtp/**`, `lib/services/pdtp/**`, `db/schema/prevention/pdtp.ts`, `db/migrations/0299_*.sql`, `0300_*.sql`, `meta/*`, `lib/__tests__/pdtp-fulfillment.test.ts`, `lib/__tests__/prevention-pdtp.test.ts`, `scripts/preflight-pdtp-accreditation-wiring.ts` (grupo A: PDTP P1); `app/(auth)/**`, `app/globals.css`, `components/layout/auth-shell.tsx`, `components/ui/server-list-filters*.tsx`, `lib/hooks/use-login.ts`, `app/(app)/solicitudes/urgency-signal.ts`, `e2e/login-hero-motion.spec.ts` (grupo B: auth/UI ajeno); `*.md` de raíz y `qa/reports/*` (grupo C: documentos).

- [ ] **Step 1: Confirmar con quien tiene abierta la otra sesión** que el grupo A está listo para commitear y que el grupo B no es de este plan. No commitear trabajo de otra sesión sin esa confirmación.
- [ ] **Step 2: Verificar que el grupo B no toca PDTP**

Run: `git diff --stat -- 'app/(auth)' components lib/hooks app/globals.css 'app/(app)/solicitudes' | grep -i pdtp`
Expected: sin salida.

- [ ] **Step 3: Commit del grupo C (documentos)**

```bash
git add PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md PDTP_COMPARATIVA_EXCEL_VS_MODULO_2026-09-16.md qa/reports/2026-09-16-pdtp-uiux.md qa/reports/latest.md
git commit -m "docs(pdtp): spec desde el Excel RE-36 y comparativa contra el módulo"
```

- [ ] **Step 4: Dejar los grupos A y B en stash separados o commitearlos por su dueño.** El grupo A continúa en la Task 0.2; el grupo B queda fuera de este plan.

### Task 0.2: Tests faltantes de la corrección P1 y commit del grupo A

**Files:**
- Create: `lib/__tests__/pdtp-revision-diff-decisions.test.ts` (PGlite; registrar en `tests/pglite-files.ts`)
- Create: `app/(app)/prevencion/pdtp/[programId]/create-pdtp-revision-button.test.tsx`
- Test existente a correr: `db/__tests__/pdtp-check-constraints.test.ts`, `lib/__tests__/prevention-pdtp.test.ts`, `lib/__tests__/pdtp-fulfillment.test.ts`

**Interfaces:**
- Consumes: tabla `pdtp_revision_diff_decisions` (working tree, `db/schema/prevention/pdtp.ts` tras `pdtpActivityExecutorAssignments`), componente `CreatePdtpRevisionButton({ sourceProgramId })`.

- [ ] **Step 1: Escribir el test PGlite de la tabla de decisiones**

```ts
// lib/__tests__/pdtp-revision-diff-decisions.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })
;(globalThis as { __db?: unknown }).__db = db

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.users).values({ id: "u1", email: "u1@e2e.cl", name: "U1", passwordHash: "x", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never)
  await db.insert(schema.pdtpPrograms).values({ id: "p1", year: 2026, version: 1, status: "draft", title: "P", elaboratedByName: "A", elaboratedByTitle: "B", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never)
  await db.insert(schema.pdtpProgramTemplates).values({ id: "t1", code: "BASE", name: "Base", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never)
  await db.insert(schema.pdtpProgramTemplateVersions).values({ id: "tv1", templateId: "t1", version: 1, sourceContentVersion: 1, contentDigest: "a".repeat(64), snapshotJson: {}, publishedAt: new Date().toISOString(), createdAt: new Date().toISOString() } as never)
})

const row = (over: Partial<schema.NewPdtpRevisionDiffDecision> = {}) => ({
  id: `d-${Math.random()}`, programId: "p1", baseTemplateVersionId: "tv1", activityIdentity: "PDT-001",
  decision: "kept", decidedByUserId: "u1", decidedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
})

describe("pdtp_revision_diff_decisions", () => {
  it("una decisión es única por (programa, versión base, identidad)", async () => {
    await db.insert(schema.pdtpRevisionDiffDecisions).values(row())
    await expect(db.insert(schema.pdtpRevisionDiffDecisions).values(row({ decision: "applied" }))).rejects.toThrow(/unique/i)
  })
  it("rechaza una decisión fuera de applied/kept", async () => {
    await expect(db.insert(schema.pdtpRevisionDiffDecisions).values(row({ activityIdentity: "PDT-002", decision: "maybe" as never }))).rejects.toThrow(/check/i)
  })
})
```

- [ ] **Step 2: Registrar el archivo en `tests/pglite-files.ts`** (agregar la ruta al array, orden alfabético).
- [ ] **Step 3: Correr y ver que pasa** — `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-revision-diff-decisions.test.ts`. Expected: 2 passed. (Si falla por columnas del `users` insert, copiar el helper de inserción de usuario de `lib/__tests__/prevention-pdtp.test.ts`.)
- [ ] **Step 4: Test del botón de revisión**

```tsx
// app/(app)/prevencion/pdtp/[programId]/create-pdtp-revision-button.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
vi.mock("../actions", () => ({ createPdtpRevisionAction: vi.fn() }))
import { CreatePdtpRevisionButton } from "./create-pdtp-revision-button"

describe("CreatePdtpRevisionButton", () => {
  it("ofrece crear una nueva versión del programa", () => {
    render(<CreatePdtpRevisionButton sourceProgramId="p1" />)
    expect(screen.getByRole("button", { name: /nueva versi/i })).toBeInTheDocument()
  })
})
```
Ajustar el nombre del action mockeado al import real del componente.

- [ ] **Step 5: Correr las suites** — `npm run db:verify-migrations` (expected: 301 entradas), `npm run typecheck`, `npm run lint`, `npm run test:fast`, `npx vitest run --config vitest.pglite.config.ts lib/__tests__/prevention-pdtp.test.ts lib/__tests__/pdtp-fulfillment.test.ts db/__tests__/pdtp-check-constraints.test.ts lib/__tests__/pdtp-revision-diff-decisions.test.ts`. Expected: todo verde.
- [ ] **Step 6: Commit del grupo A**

```bash
git add app/\(app\)/prevencion/pdtp lib/services/pdtp lib/__tests__ db/schema/prevention/pdtp.ts db/migrations scripts/preflight-pdtp-accreditation-wiring.ts tests/pglite-files.ts
git commit -m "fix(pdtp): ejecutores acreditadores por rol y salida a nueva revisión ante desvío de huella (QA 2026-09-16 P1)"
```

### Task 0.3: Dos specs E2E PDTP en verde y recorrido del QA

- [ ] **Step 1:** `npx playwright test e2e/pdtp-annual-adjustments.spec.ts e2e/pdtp-lifecycle-approvals.spec.ts` (con la base E2E levantada según `scripts/run-e2e.sh`). Si fallan por labels nuevos del detalle o del panel de cobertura, corregir los selectores del spec (no el producto) y repetir hasta 2 corridas verdes.
- [ ] **Step 2:** Repetir a mano los dos hallazgos P1 de `qa/reports/2026-09-16-pdtp-uiux.md` con una sesión `prevención` + `program:manage`: (a) en cobertura, las actividades sin ejecutor válido muestran estado "No acreditable" y una acción; (b) en un programa activo con desvío de huella aparece "Crear nueva versión". Anotar el resultado en `qa/reports/2026-09-16-pdtp-uiux.md` (sección "Verificación posterior").
- [ ] **Step 3: Commit** — `git commit -am "test(e2e): alinear specs PDTP con las acciones nuevas del detalle"`.

**Aceptación Fase 0:** tres grupos separados; migraciones verificadas; suites verdes; los dos specs PDTP pasan dos veces seguidas; QA P1 verificados a mano.

---

## Fase 1 — Objetivos (G6), métrica "en cero" y export RE-36 (G1)

### Task 1.1: Tabla `pdtp_objectives` y columna `pdtp_activities.objective_id`

**Files:**
- Modify: `db/schema/prevention/pdtp.ts` (nueva tabla junto a `pdtpSheets`; columna en `pdtpActivities`; relations; types)
- Create: `db/migrations/0301_*.sql` (generada)
- Modify: `db/__tests__/pdtp-check-constraints.test.ts`

**Interfaces:**
- Produces: `pdtpObjectives` (`id, programId, code, name, displayOrder, createdAt, updatedAt`), `pdtpActivities.objectiveId: string | null`, tipos `PdtpObjective`, `NewPdtpObjective`.

- [ ] **Step 1: Test de CHECKs que falla**

Agregar en `db/__tests__/pdtp-check-constraints.test.ts` (seguir el patrón de los casos existentes):
```ts
it("pdtp_objectives rechaza código o nombre vacío y objetivo de otro programa", async () => {
  await expect(insertObjective({ code: " ", name: "X" })).rejects.toThrow(/check/i)
  await expect(insertObjective({ code: "1", name: "" })).rejects.toThrow(/check/i)
  await insertObjective({ id: "p2-obj-1", programId: "p2", code: "1", name: "Otro" })
  await expect(db.update(schema.pdtpActivities).set({ objectiveId: "p2-obj-1" }).where(eq(schema.pdtpActivities.id, "act-p1"))).rejects.toThrow(/foreign key/i)
})
```
- [ ] **Step 2: Correr** — `npx vitest run --config vitest.pglite.config.ts db/__tests__/pdtp-check-constraints.test.ts`. Expected: FAIL (tabla inexistente).
- [ ] **Step 3: Esquema**

```ts
export const pdtpObjectives = pgTable("pdtp_objectives", {
  id:           text("id").primaryKey(),
  programId:    text("program_id").notNull().references(() => pdtpPrograms.id, { onDelete: "cascade" }),
  code:         text("code").notNull(),
  name:         text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("pdtp_objectives_program_code_unique").on(table.programId, table.code),
  uniqueIndex("pdtp_objectives_program_id_unique").on(table.programId, table.id),
  check("pdtp_objectives_code_check", sql`length(trim(${table.code})) > 0`),
  check("pdtp_objectives_name_check", sql`length(trim(${table.name})) > 0`),
  check("pdtp_objectives_display_order_check", sql`${table.displayOrder} >= 0`),
])
```
En `pdtpActivities`: `objectiveId: text("objective_id"),` y en el array de constraints:
```ts
foreignKey({
  columns: [table.programId, table.objectiveId],
  foreignColumns: [pdtpObjectives.programId, pdtpObjectives.id],
  name: "pdtp_activities_objective_same_program_fk",
}).onDelete("set null"),
index("pdtp_activities_program_objective_idx").on(table.programId, table.objectiveId),
```
(`pdtpObjectives` debe declararse **antes** de `pdtpActivities` en el archivo.) Relations: `objective: one(pdtpObjectives, …)` en `pdtpActivitiesRelations`; `objectives: many(pdtpObjectives)` en `pdtpProgramsRelations`. Types al final del archivo.

- [ ] **Step 4:** `npm run db:generate` → revisar el SQL generado (una tabla, una columna, una FK compuesta) → `npm run db:migrate` → `npm run db:verify-migrations`.
- [ ] **Step 5: Correr el test** — Expected: PASS.
- [ ] **Step 6: Commit** — `git add db && git commit -m "feat(pdtp): objetivos del programa como entidad (tabla pdtp_objectives)"`.

### Task 1.2: Servicio de objetivos y mapa 2026

**Files:**
- Create: `lib/services/pdtp/objectives.ts`
- Create: `lib/services/pdtp/objectives.test.ts` (puro)
- Create: `lib/__tests__/pdtp-objectives.test.ts` (PGlite; registrar)
- Modify: `lib/services/pdtp/activities.ts:131-164` (`PdtpActivityUpdateInput.objectiveId`), `:193-240` (`batchUpdatePdtpActivities` acepta `objectiveId`)
- Modify: `lib/services/pdtp/content-digest.ts` (`schemaVersion: 14`, incluir `objectives` y `activities[].objectiveCode`)
- Modify: `lib/services/pdtp/programs.ts` (copia y revisión v+1 clonan objetivos y remapean), `lib/services/pdtp/templates.ts` (snapshot/materialización incluyen objetivos)
- Modify: `lib/services/pdtp/index.ts` (re-export)

**Interfaces:**
```ts
export type PdtpObjective = typeof pdtpObjectives.$inferSelect
export const PDTP_2026_OBJECTIVES: ReadonlyArray<{ code: string; name: string; from: number; to: number }>
export function pdtpObjectiveForLegacyNumber(n: number): string | null
export async function listPdtpObjectives(programId: string): Promise<PdtpObjective[]>
export async function upsertPdtpObjective(input: { programId: string; id?: string; code: string; name: string; displayOrder?: number }, userId: string): Promise<PdtpObjective>
export async function deletePdtpObjective(input: { programId: string; objectiveId: string }, userId: string): Promise<void>
export async function reorderPdtpObjectives(input: { programId: string; orderedIds: string[] }, userId: string): Promise<void>
export async function setPdtpActivityObjective(input: { programId: string; activityId: string; objectiveId: string | null }, userId: string): Promise<void>
```
Los 8 objetivos (nombre exacto del RE-36, rangos): `1 FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO 1–9`, `2 MANTENER A LA EMPRESA Y SUS SUCURSALES ENTRE LOS MÁRGENES DE LA NORMATIVA LEGAL VIGENTE 10–34`, `3 DETECTAR, EVALUAR, MEDIR Y CORREGIR CONDICIONES Y CONDUCTAS SUB-ESTÁNDAR 35–50`, `4 REFORZAR LA CULTURA PREVENTIVA DEL PERSONAL 51–60`, `5 ELEMENTOS DE PROTECCIÓN PERSONAL (EPP) 61–65`, `6 CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE ACCIDENTES E INCIDENTES 66–78`, `7 CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE CONTINGENCIA Y SUS INSTRUCTIVOS 79–84`, `8 CAMPAÑAS DE SEGURIDAD Y SALUD EN EL TRABAJO 85–89`.

- [ ] **Step 1: Test puro que falla**

```ts
// lib/services/pdtp/objectives.test.ts
import { describe, expect, it } from "vitest"
import { PDTP_2026_OBJECTIVES, pdtpObjectiveForLegacyNumber } from "./objectives"
describe("objetivos 2026", () => {
  it("mapea los números del RE-36 a su objetivo", () => {
    expect(pdtpObjectiveForLegacyNumber(9)).toBe("1")
    expect(pdtpObjectiveForLegacyNumber(10)).toBe("2")
    expect(pdtpObjectiveForLegacyNumber(89)).toBe("8")
    expect(pdtpObjectiveForLegacyNumber(90)).toBeNull()
  })
  it("cubre 1..89 sin huecos ni solapes", () => {
    const covered = PDTP_2026_OBJECTIVES.flatMap((o) => Array.from({ length: o.to - o.from + 1 }, (_, i) => o.from + i))
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 89 }, (_, i) => i + 1))
  })
})
```
- [ ] **Step 2:** `npx vitest run lib/services/pdtp/objectives.test.ts` → FAIL. Implementar `objectives.ts` (mapa + CRUD con `assertPdtpProgramEditableState` de `lib/services/pdtp/lifecycle.ts` y `addPdtpChangeLogEntry(programId, version, userId, "objectives", before, after, note, tx)` como en `activities.ts`). → PASS.
- [ ] **Step 3: Test PGlite**

Casos en `lib/__tests__/pdtp-objectives.test.ts` (setup como en `prevention-pdtp.test.ts`): "eliminar un objetivo deja `objectiveId` en null en sus actividades"; "la función de revisión v+1 de `programs.ts` (~l.351, la que usa `create-pdtp-revision-button.tsx`) conserva los objetivos y remapea `objectiveId` en la copia"; "la huella (`buildPdtpProgramContentSnapshot`) cambia al asignar objetivo y reporta `schemaVersion` 14"; "`batchUpdatePdtpActivities` con `objectiveId` asigna a N actividades". Registrar en `tests/pglite-files.ts`. Correr → FAIL → implementar cambios en `activities.ts`, `programs.ts`, `templates.ts`, `content-digest.ts` → PASS.
- [ ] **Step 4:** `npm run test:fast` (los tests de huella existentes, p. ej. `pdtp-2026-contract.test.ts`, pueden fijar `schemaVersion`; actualizar a 14 con nota). `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(pdtp): servicio de objetivos, mapa 2026 y objetivo en la huella firmada"`.

### Task 1.3: Script de backfill 2026 y acciones/UI de objetivos

**Files:**
- Create: `scripts/apply-pdtp-2026-objectives.ts` (patrón `scripts/apply-pdtp-2026-mechanisms.ts`: `DRY_RUN`, `DEPLOY_MODE`, idempotente) + `package.json` script `"pdtp:apply-objectives"` + línea en `scripts/apply-pdtp-data.sh`
- Create: `app/(app)/prevencion/pdtp/actions/objectives.ts` (`upsertPdtpObjectiveAction`, `deletePdtpObjectiveAction`, `reorderPdtpObjectivesAction`, `setPdtpActivityObjectiveAction`; guard `prevention:pdtp:program:manage`; patrón `actions/executors.ts`) y re-export en `app/(app)/prevencion/pdtp/actions.ts`
- Create: `app/(app)/prevencion/pdtp/[programId]/editar/tabs/objetivos-tab.tsx` + `objetivos-tab.test.tsx`; registrar en `builder-tabs.tsx`
- Modify: `app/(app)/prevencion/pdtp/[programId]/editar/tabs/actividades-tab.tsx` (select "Objetivo" por fila y en edición masiva)
- Modify: `app/(app)/prevencion/pdtp/actividades/page.tsx` (`searchParams.objetivo`, filtro en barra, `?objetivo=` en `buildPdtpActivitiesHref` de `pdtp-context.ts`), `pdtp-sheet-table.tsx` (cabecera de grupo por objetivo en `vista=anual`)
- Modify: `e2e/setup-db.ts` (objetivo fixture para `pdtp-prog-e2e` y `pdtp-draft-e2e`); Create: `e2e/pdtp-objetivos.spec.ts`

- [ ] **Step 1: Test del script** — `scripts/__tests__/apply-pdtp-2026-objectives.test.ts` (PGlite si existe patrón para scripts; si no, test del helper puro `planObjectiveAssignments(activities: Array<{ id; n; objectiveId }>) → Array<{ activityId; objectiveCode }>` que ignora las ya asignadas). Correr → FAIL → implementar → PASS.
- [ ] **Step 2: Test de componente** `objetivos-tab.test.tsx`: renderiza los objetivos ordenados y el conteo de actividades por objetivo; el botón "Agregar objetivo" abre el formulario con código y nombre. → FAIL → implementar (UI con `Table`, `Button`, `Field`, `Select` del design system; reordenar con botones ↑/↓, no drag) → PASS.
- [ ] **Step 3: Aplicar en local** — `DRY_RUN=1 npm run pdtp:apply-objectives` (revisar plan) y luego sin `DRY_RUN`. Esperado: 8 objetivos creados, 81 actividades activas asignadas, retiradas también asignadas por número. Nota: el programa activo local pasará a `digestDrift=true` (objetivos entran en la huella); es esperado y el botón "Crear nueva versión" lo resuelve; en producción el script corre **antes** de firmar.
- [ ] **Step 4: E2E** `e2e/pdtp-objetivos.spec.ts`: en `pdtp-draft-e2e` crear "Objetivo E2E", asignarlo a "Actividad ajustable anual E2E", abrir `/prevencion/pdtp/actividades?programa=pdtp-draft-e2e&objetivo=<id>` y ver solo esa actividad. Correr → verde.
- [ ] **Step 5: Commit** — `git commit -m "feat(pdtp): objetivos en editor, filtro de actividades y backfill 2026"`.

### Task 1.4: Métrica "actividades planificadas en cero" (sin cambiar la fórmula)

**Files:**
- Modify: `lib/services/pdtp/compliance.ts:19-50` (tipos), `:292-356` (bucle mensual), `getPdtpComplianceIndicatorsForScope` (agregado)
- Create: `lib/__tests__/pdtp-compliance-zero.test.ts` (PGlite; registrar)
- Modify: `app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx` + `.test.tsx`, `app/(app)/prevencion/pdtp/page.tsx` (detalle del KPI)

**Interfaces:**
```ts
export type PdtpComplianceMonth = { month: number; planned: number; executed: number; percent: number | null; zeroActivities: number; zeroActivityIds: string[] }
// annual gana: zeroActivityMonths: number; zeroActivityIds: string[]
```
Regla: en la rama "resto" del bucle (no `coverage`, no `closed_on_time`), si `p > 0 && rawExecuted === 0` → cuenta. `ForScope` suma por mes y une ids.

- [ ] **Step 1: Test PGlite que falla** — programa activo con 3 actividades A,B,C planificadas 1 en marzo; ejecución aprobada solo en A con cantidad 3 → `monthly[2].percent === 1` (compensación, fórmula intacta) **y** `monthly[2].zeroActivities === 2` con ids B y C; una actividad `coverage` en cero no cuenta; `getPdtpComplianceIndicatorsForScope` con dos faenas suma.
- [ ] **Step 2:** Correr → FAIL → implementar → PASS. `npm run test:fast` (tests de compliance existentes deben seguir verdes: no cambia `percent`).
- [ ] **Step 3: UI** — en el panel, columna "En cero" por mes con `title="Actividades con planificación en el mes y ninguna ejecución aprobada. El % mensual puede llegar a 100 % por compensación entre actividades."` y enlace a `activitiesHref(..., "semana", "overdue", { month })`; en el dashboard, `detail` del KPI "Pendientes" pasa a `"${zero} actividades en cero este mes"`. Test de componente: renderiza el conteo.
- [ ] **Step 4: Commit** — `git commit -m "feat(pdtp): exponer actividades planificadas en cero junto al cumplimiento mensual"`.

### Task 1.5: Modelo de documento RE-36

**Files:**
- Create: `lib/services/pdtp/re36-document.ts`
- Modify: `lib/services/pdtp/compliance.ts` (exportar `effectiveApprovedExecutionsByCell(rows)` — hoy privada en l.106, ya agrupa por celda semanal)
- Create: `lib/__tests__/pdtp-re36-document.test.ts` (PGlite; registrar)
- Modify: `lib/services/pdtp/index.ts`

**Interfaces:**
```ts
export type PdtpRe36Cell = { p: number | null; e: number | null; note?: string }
export type PdtpRe36Row = { activityId: string; n: number; objectiveCode: string | null; objectiveName: string | null; program: string; activity: string; responsibles: string; assigneeNames: string[]; scheduleMode: "scheduled" | "on_demand" | "triggered"; cells: PdtpRe36Cell[] /* 48: (month-1)*4+(week-1) */ }
export type PdtpRe36Band = { code: string | null; name: string; fromRow: number; toRow: number }
export type PdtpRe36Sheet = { code: string; label: string; rows: PdtpRe36Row[]; bands: PdtpRe36Band[] }
export type PdtpRe36DeviationRow = { n: number; activity: string; month: number; week: number; kind: string; reason: string; targetMonth: number | null; targetWeek: number | null; recordedBy: string; recordedAt: string }
export type PdtpRe36Document = {
  program: { id: string; year: number; version: number; title: string; documentCode: string; documentRevision: string | null; indicatorName: string | null; indicatorType: string | null; indicatorFormula: string | null; indicatorPeriodicity: string | null; measurementOwner: string | null; complianceTarget: number; annualPercent: number | null }
  worksite: { id: string; name: string; code: string }
  cutoff: { asOf: string; year: number; month: number | null }
  sheets: PdtpRe36Sheet[]
  platformIndicators: { monthly: Array<{ month: number; planned: number; executed: number; percent: number | null; zeroActivities: number }>; quarterly: Array<{ quarter: number; planned: number; executed: number; percent: number | null }> }
  signatures: { elaboratedBy: { name: string; title: string; at: string | null }; reviewedByJdpr: { name: string; title: string; at: string } | null; approvedByLegal: { name: string; title: string; at: string } | null }
  changeControl: Array<{ at: string; description: string; actor: string | null }>
  glossary: Array<{ code: string; label: string }>
  legend: { onDemand: string; e0: string; eGte1: string }
  deviations: PdtpRe36DeviationRow[]
}
export async function buildPdtpRe36Document(input: { programId: string; worksiteId: string; scope: WorksiteScope; sheetCodes?: string[] }): Promise<PdtpRe36Document>
```
Fuentes: `getPdtpProgram`, `listPdtpProgramSheets`, `loadProgramScheduleAndExecutions(activityIds, year, worksiteId)`, ejecuciones `status === "approved"` → `effectiveApprovedExecutionsByCell`, `listPdtpObjectives`, `getPdtpComplianceIndicators(programId, worksiteId)`, `pdtp_document_history` (elaboración/aprobación/cambios declarados), `pdtp_change_log` con `changedAt >= program.reviewStartedAt`, `pdtp_responsible_catalog` (slugs usados) + `pdtp_role_legend_entries`, `users.name` de `approvedByJdprUserId` / `approvedByLegalUserId`. `p: null` sin celda; `e: null` sin ejecución. Orden: `objective.displayOrder, n`. Sin objetivos → bandas por `pdtpActivities.program`. `deviations` y `assigneeNames` vacíos hasta Fases 3 y 5. Textos por `sanitizeCell` de `lib/reports/export-module/excel-builder.ts`.

- [ ] **Step 1: Test PGlite que falla** — programa activo, 2 actividades (una con objetivo "1", otra "2"), override de faena P=2 en feb S1, ejecución `submitted` y otra `approved` en la misma celda, una actividad excluida en la faena, 1 entrada de changelog anterior a `reviewStartedAt` y 1 posterior. Afirmar: E cuenta solo la aprobada; P refleja el override; la excluida no aparece; 2 bandas en orden; `changeControl` solo la posterior; `Σ p` del documento `=== indicators.annual.planned`.
- [ ] **Step 2:** Correr → FAIL → implementar → PASS. Commit: `git commit -m "feat(pdtp): modelo de documento RE-36 por faena"`.

### Task 1.6: Renderer ExcelJS del RE-36

**Files:**
- Create: `lib/reports/pdtp-re36-workbook.ts`
- Create: `lib/reports/pdtp-re36-workbook.test.ts` (puro, fixture en el mismo test)

**Interfaces:**
```ts
export const RE36_LAYOUT = { titleRow: 1, indicatorFirstRow: 4, legendRow: 12, monthHeaderRow: 13, weekHeaderRow: 14, firstDataRow: 16, fixedColumns: 5, weeksPerMonth: 4, monthsCount: 12 } as const
export function re36CellAddress(monthIndex: number, weekIndex: number, kind: "P" | "E", row: number): string
export function renderPdtpRe36Workbook(doc: PdtpRe36Document, options?: { quarterFormula?: "ratio" | "average" }): ExcelJS.Workbook
export async function renderPdtpRe36Buffer(doc: PdtpRe36Document, options?: { quarterFormula?: "ratio" | "average"; session?: Session }): Promise<ArrayBuffer>
```
Layout por hoja (uno por `doc.sheets`, nombre vía `safeWorksheetName`): fila 1 título + "CÓDIGO: RE-36"; filas 4–10 los 7 campos de indicadores ("Resultado" = `annualPercent` en `0%`); fila 12 `P: Planeado  E: Ejecutado`; fila 13 meses (merge de 8 columnas), fila 14 `Sem 1..4` (merge de 2) y fila 15 `P`/`E`; banda naranja `FFC000` "Planeación del plan de trabajo anual"; columnas A–E anchos 6/5/40/27/29, F.. anchos 3.5; `views = [{ state: "frozen", xSplit: 5, ySplit: 15 }]`; OBJETIVO en `mergeCells` vertical con `textRotation: 90`; filas `on_demand`/`triggered` con `fill lightUp` gris sobre las 96 celdas; condicional en columnas E: `cellIs equal 0 → FFFF0000`, `cellIs greaterThanOrEqual 1 → FF00B050`; escala de color en P (1→`FFFFC000`, 5→más intenso); totales tras la última fila: "Actividades Programadas (P)" `=SUM(F16:F{last})`, "Actividades Ejecutadas (E)" `=SUM(G16:G{last})`, "% semanal" `=IFERROR(G{tot}/F{tot},"")`, "% trimestral" `=IFERROR(SUM(E_q)/SUM(P_q),"")` (`ratio`, con `note`; `average` reproduce `AVERAGE` del Excel); fila "Indicador plataforma (mensual)" y "Actividades en cero" desde `platformIndicators`; pie: firmas (nombre/cargo/fecha), tabla control de cambios, glosario, leyenda. Hoja "Desvíos" siempre (cabecera `N° | Actividad | Mes | Sem | Tipo | Motivo | Destino | Registrado por | Fecha`). `addExportMetadataSheet` si hay sesión. Salida `workbook.xlsx.writeBuffer()` (**no** `xlsxToBase64`, que reescribiría las fórmulas); los textos ya vienen sanitizados del documento.

- [ ] **Step 1: Tests que fallan** (fixture: 3 actividades en 2 objetivos, 1 a demanda, P/E en 4 celdas):
  - "la banda OBJETIVO fusiona las filas de sus actividades" (`worksheet.model.merges` contiene `A16:A17`)
  - "las columnas E tienen reglas condicionales 0→rojo y ≥1→verde"
  - "la fila a demanda tiene relleno lightUp en las 96 celdas"
  - "los totales P/E son fórmulas SUM sobre el rango de datos" (`cell.formula === "SUM(F16:F18)"`)
  - "el % semanal es IFERROR(E/P,'')"
  - "paneles congelados en 5 columnas y 15 filas"
  - "firmas, control de cambios y glosario aparecen tras los totales"
  - "emite una hoja por doc.sheets más Desvíos"
- [ ] **Step 2:** `npx vitest run lib/reports/pdtp-re36-workbook.test.ts` → FAIL → implementar (todos los rangos calculados desde `RE36_LAYOUT` y `rows.length`, nunca fijos) → PASS.
- [ ] **Step 3: Abrir el archivo** — escribir un archivo temporal desde el test (`fs.writeFileSync` en `.tmp/re36-fixture.xlsx`) y validarlo con `python3 /home/allopze/.claude/skills/.../xlsx/scripts/recalc.py .tmp/re36-fixture.xlsx` (LibreOffice recalcula; expected `errors_found: 0`). Borrar el temporal.
- [ ] **Step 4: Commit** — `git commit -m "feat(reportes): renderer ExcelJS del formato RE-36"`.

### Task 1.7: Route de export y UI

**Files:**
- Modify: `app/api/prevencion/pdtp/export/route.ts` (param `formato`: `re36` default | `plano`; `auditOutcome.newState.formato`; filename `RE-36-PDTP-${year}-${worksite.code}-v${version}.xlsx`)
- Modify: `app/api/prevencion/pdtp/export/route.test.ts` (dispatch por formato)
- Modify: `app/(app)/prevencion/pdtp/[programId]/page.tsx:186-190` (dos ítems: "Exportar RE-36" / "Exportar planilla plana")
- Modify: `e2e/pdtp-templates-exports.spec.ts` (descarga `?formato=re36`, abrir con ExcelJS y afirmar hoja, celda con "RE-36" y fórmula en totales)

- [ ] **Step 1:** Test de route: `formato=plano` sigue llamando a `buildPdtpExport` (mock) y `formato` ausente llama a `buildPdtpRe36Document` + `renderPdtpRe36Buffer`. → FAIL → implementar → PASS.
- [ ] **Step 2:** E2E verde. `npm run test:fast`, `typecheck`, `lint`.
- [ ] **Step 3: Verificación manual** — exportar el programa 2026 local para una faena; abrir en LibreOffice: 8 bandas en orden, sin diálogo de reparación, totales calculando. Anotar en `qa/reports/`.
- [ ] **Step 4: Commit** — `git commit -m "feat(pdtp): exportar el programa con el formato RE-36 (planilla plana conservada)"`.

**Aceptación Fase 1:** objetivos editables y filtrables; "en cero" visible en panel y tablero; el Excel RE-36 abre sin reparación, ΣP anual del documento coincide con `indicators.annual.planned`; `?formato=plano` idéntico al anterior.

---

## Fase 2 — Presets de planificación, aplicación masiva y carga por rol (G2)

### Task 2.1: `weeks` en la regla de recurrencia (retrocompatible)

**Files:**
- Modify: `lib/services/pdtp/recurrence.ts` (`PdtpRecurrenceRule.weeks?: number[]`; `resolveWeeks(rule, weeksPerMonth)`; `projectRecurrenceToLegacySchedule` usa `weeks` para no-weekly y respeta `months` en `weekly`; `recurrenceRulesEqual` compara `weeks` normalizados; `describePdtpRecurrence`: "quincenal (semanas 1 y 3)", "campaña (jun–jul)")
- Modify: `lib/validation/prevention-module/pdtp.ts:71` (`weeks: z.array(z.number().int().min(1).max(4)).min(1).max(4).optional()` con `transform` a único-ordenado)
- Create/Modify: `lib/services/pdtp/recurrence.test.ts`

- [ ] **Step 1: Tests que fallan** — "`{monthly, weeks:[1,3]}` proyecta 24 celdas en semanas 1 y 3"; "`{weekly, months:[6,7]}` proyecta 8 celdas"; "`{weekly, plannedQuantity:5}` proyecta 48 celdas de 5"; "retrocompatibilidad: 6 reglas históricas sin `weeks` producen el mismo `scheduleCellsFingerprint` que antes" (fijar los fingerprints actuales en el test antes de tocar el código).
- [ ] **Step 2:** Correr → FAIL → implementar → PASS. `npm run test:fast`.
- [ ] **Step 3: Commit** — `git commit -m "feat(pdtp): semanas múltiples y meses en la regla de recurrencia"`.

### Task 2.2: Presets como módulo puro

**Files:**
- Create: `lib/services/pdtp/schedule-presets.ts`, `lib/services/pdtp/schedule-presets.test.ts`

**Interfaces:**
```ts
export type PdtpSchedulePresetKey = "weekly" | "daily" | "monthly_week" | "biweekly_13" | "biweekly_24" | "quarterly" | "campaign" | "punctual"
export type PdtpSchedulePresetParams = { weekOfMonth?: number; plannedQuantity?: number; monthFrom?: number; monthTo?: number; cells?: Array<{ month: number; week: number }> }
export const PDTP_SCHEDULE_PRESETS: ReadonlyArray<{ key: PdtpSchedulePresetKey; label: string; needs: Array<keyof PdtpSchedulePresetParams> }>
export function presetToRule(key: PdtpSchedulePresetKey, params: PdtpSchedulePresetParams): PdtpRecurrenceRule | null   // null para punctual
export function presetToCells(key: PdtpSchedulePresetKey, params: PdtpSchedulePresetParams, horizon: PdtpScheduleHorizon): PdtpScheduleCell[]
```
Labels: Semanal · Diario (n por semana) · Mensual, semana N · Quincenal (S1/S3) · Quincenal (S2/S4) · Trimestral · Campaña (rango de meses, todas las semanas) · Puntual (celdas elegidas).

- [ ] **Step 1: Tests que fallan** — cada preset contra el Anexo A del spec: quincenal act. 37 = 24 celdas S2/S4; campaña act. 88 jun–jul = 8; diario act. 38 = 48 × 5 = 240; mensual S3 feb–dic = 11 (con `months`); puntual = exactamente las celdas dadas; `presetToCells` de un preset con regla es idéntico a `projectRecurrenceToLegacySchedule(presetToRule(...))`.
- [ ] **Step 2:** FAIL → implementar → PASS → Commit `git commit -m "feat(pdtp): presets de planificación sobre la regla de recurrencia"`.

### Task 2.3: Aplicación masiva en servicio y acción

**Files:**
- Modify: `lib/services/pdtp/activities.ts:325-414` (extraer `writePdtpActivitySchedule(tx, { activity, program, horizon, cells, origin, replaceConfirmed, expectedFingerprint, userId })`; `updatePdtpActivity` lo usa)
- Create: `lib/services/pdtp/schedule-batch.ts` con `applyPdtpSchedulePresetToActivities(input: { programId: string; activityIds: string[]; preset: PdtpSchedulePresetKey; params: PdtpSchedulePresetParams; mode: "replace" | "fill_empty"; replaceConfirmed?: boolean }, userId: string): Promise<{ applied: string[]; skippedConflicts: Array<{ activityId: string; n: number; reason: "manual_schedule_would_be_replaced" | "not_scheduled_mode" | "retired" }> }>`
- Modify: `lib/validation/prevention-module/pdtp.ts` (`pdtpSchedulePresetBatchSchema`, máx 200 ids)
- Modify: `app/(app)/prevencion/pdtp/actions/activities.ts` (`applyPdtpSchedulePresetAction`, guard `prevention:pdtp:program:manage`)
- Create: `lib/__tests__/pdtp-schedule-presets-batch.test.ts` (PGlite; registrar)

Reglas: una transacción, `SELECT … FOR UPDATE` por actividad, `assertPdtpProgramEditableState`; retiradas y `scheduleMode !== "scheduled"` → `skippedConflicts`; con preset de regla se escribe `recurrenceRule` (fuente "rule"); `fill_empty` solo actúa sobre actividades con `derivePdtpScheduleSource === "none"`; un solo `addPdtpChangeLogEntry` sección `schedule:batch` con `before/after` por actividad.

- [ ] **Step 1: Tests que fallan** — "aplica quincenal a 3 actividades y deja `recurrenceRule` coherente"; "una actividad con celdas manuales entra en `skippedConflicts` sin `replaceConfirmed` y se aplica con él"; "`fill_empty` no toca actividades planificadas"; "programa `in_review` → error"; "changelog registra antes/después".
- [ ] **Step 2:** FAIL → refactor + implementar → PASS; `npm run test:fast` (tests de `updatePdtpActivity` intactos). Commit `git commit -m "feat(pdtp): aplicar un patrón de planificación a varias actividades"`.

### Task 2.4: UI del planificador (presets, selección múltiple, carga por rol)

**Files:**
- Modify: `app/(app)/prevencion/pdtp/[programId]/editar/tabs/planificacion-tab.tsx:412-416` (reemplazar `ROW_PRESETS` por `PDTP_SCHEDULE_PRESETS` con submenú de parámetros; columna checkbox; barra "N seleccionadas · Aplicar patrón… · Limpiar")
- Create: `app/(app)/prevencion/pdtp/[programId]/editar/apply-preset-dialog.tsx` (+ `.test.tsx`)
- Create: `lib/services/pdtp/role-load.ts` con `computePdtpRoleLoad(input: { activities: Array<{ id: string; responsibleSlugs: string[] }>; cells: Array<{ activityId: string; month: number; week: number; plannedQuantity: number }>; catalog: Array<{ slug: string; displayName: string }> }): Array<{ slug: string; displayName: string; weekly: number[]; monthly: number[]; total: number; activityCount: number }>` + `role-load.test.ts`
- Create: `app/(app)/prevencion/pdtp/[programId]/editar/role-load-panel.tsx` (colapsable con `PersistedDetails`; calcula en cliente con los valores vivos; resalta semanas > umbral 10)
- Modify: `planificacion-tab.test.tsx`; Create: `e2e/pdtp-planificacion-presets.spec.ts`

- [ ] **Step 1:** `role-load.test.ts`: act. 38 (5/sem, `sup`+`jt`) y act. 6 (1/sem, `prf`,`adm_contrato`,`sup`,`jt`) → `sup.weekly[0] === 6`; una actividad con 2 responsables suma a ambos. FAIL → implementar → PASS.
- [ ] **Step 2:** `apply-preset-dialog.test.tsx`: elegir "Quincenal (S1/S3)" con dos ids invoca `applyPdtpSchedulePresetAction({ activityIds: [a,b], preset: "biweekly_13", mode: "replace" })`; con conflictos muestra la lista y el botón "Reemplazar manuales". FAIL → implementar → PASS.
- [ ] **Step 3:** Tras aplicar, el diálogo hace `router.refresh()`; las filas abiertas re-adoptan `initial` (mecanismo existente `planificacion-tab.tsx:440-449`). Test de la tab: "seleccionar dos filas y aplicar invoca la acción".
- [ ] **Step 4: E2E** sobre `pdtp-draft-e2e`: aplicar "Diario (5 por semana)" a la actividad fixture → total 240 en el pie; "Carga por rol" visible. Verde.
- [ ] **Step 5: Commit** — `git commit -m "feat(pdtp): presets completos, selección múltiple y carga por rol en el planificador"`.

**Aceptación Fase 2:** las 89 actividades del Anexo A se expresan con un preset o "puntual"; fingerprints históricos intactos; masivo no destruye planificación manual sin confirmar.

---

## Fase 3 — Desvíos por celda (G3): no realizada, no aplica, reprogramada

### Task 3.1: Tabla `pdtp_execution_deviations`

**Files:**
- Modify: `db/schema/prevention/pdtp.ts` (tras `pdtpExecutions`)
- Create: `db/migrations/0302_*.sql` (generada)
- Modify: `db/__tests__/pdtp-check-constraints.test.ts`

Columnas: `id` PK; `activityId` FK cascade; `worksiteId` FK cascade; `year`, `month` (1–12), `week` (1–4); `kind` CHECK `('not_performed','not_applicable','reprogrammed')`; `reason` CHECK `length(trim) >= 10`; `targetMonth` / `targetWeek` NULL con CHECK `(kind <> 'reprogrammed') = (target_month IS NULL AND target_week IS NULL)` y `kind <> 'reprogrammed' OR (target_month, target_week) <> (month, week)`; `status` CHECK `('active','withdrawn')` default `active`; `createdByUserId`, `createdAt`; `withdrawnByUserId`, `withdrawnAt`, `withdrawReason` con CHECK `status <> 'withdrawn' OR (withdrawn_by_user_id IS NOT NULL AND withdrawn_at IS NOT NULL AND length(trim(COALESCE(withdraw_reason,''))) >= 10)`; `uniqueIndex(...).on(activityId, worksiteId, year, month, week).where(sql\`status = 'active'\`)`; `index(worksiteId, year, month)`.

- [x] **Step 1:** Tests de CHECK (kind inválido; `reprogrammed` sin destino; destino igual a origen; `withdrawn` sin motivo; segundo activo en la misma celda viola el índice parcial). FAIL → esquema → `db:generate` → `db:migrate` → `db:verify-migrations` → PASS. Commit `git commit -m "feat(pdtp): tabla de desvíos por celda"`.

### Task 3.2: Servicio de desvíos y costura única

**Files:**
- Create: `lib/services/pdtp/deviations.ts`, `lib/services/pdtp/deviations.test.ts` (puro)
- Modify: `lib/services/pdtp/helpers.ts:176-221` (`loadProgramScheduleAndExecutions` carga desvíos activos cuando hay `worksiteId` y aplica `applyDeviationsToSchedule` **después** de overrides y exclusiones; devuelve además `deviationRows`)
- Modify: `lib/services/pdtp/executions.ts:16` (`markPdtpExecution`: rechaza si hay `not_applicable`/`reprogrammed` activo en la celda; con `not_performed` activo y cantidad > 0, lo retira automáticamente con motivo "Ejecución registrada posteriormente")
- Modify: `lib/validation/prevention-module/pdtp.ts` (`pdtpDeviationSchema`)
- Create: `lib/__tests__/pdtp-deviations.test.ts` (PGlite; registrar)

**Interfaces:**
```ts
export type PdtpDeviationKind = "not_performed" | "not_applicable" | "reprogrammed"
export type PdtpExecutionDeviation = typeof pdtpExecutionDeviations.$inferSelect
export async function recordPdtpDeviation(input: unknown, userId: string, scope: WorksiteScope): Promise<PdtpExecutionDeviation>
export async function withdrawPdtpDeviation(input: { deviationId: string; reason: string }, userId: string, scope: WorksiteScope): Promise<void>
export async function loadPdtpDeviations(activityIds: string[], year: number, worksiteId: string): Promise<PdtpExecutionDeviation[]>   // solo active
export function applyDeviationsToSchedule<T extends { activityId: string; month: number; week: number; plannedQuantity: number; sourceColumn: string }>(rows: T[], deviations: PdtpExecutionDeviation[]): T[]
export function deviationsByActivityMonth(deviations: PdtpExecutionDeviation[]): Map<string, { notPerformed: number; notApplicable: number; reprogrammed: number }>
export async function listPdtpDeviationsForProgram(programId: string, worksiteId: string, scope: WorksiteScope): Promise<Array<PdtpExecutionDeviation & { activityN: number; activityName: string; userName: string }>>
```
`applyDeviationsToSchedule`: `not_applicable` elimina la celda; `reprogrammed` mueve `plannedQuantity` al destino (suma si existe; `sourceColumn: "deviation:<id>"`); `not_performed` no toca P. Validaciones de `recordPdtpDeviation`: programa activo; faena operable y en alcance; período ≥ activación; actividad efectiva y no excluida; P efectivo > 0 para `not_applicable`/`reprogrammed`; destino dentro del año y del horizonte; `not_performed` no en períodos futuros; no crear si hay ejecución `submitted|approved` con cantidad > 0 en la celda. Changelog sección `deviation:{n}` (no altera la huella: la tabla no entra en `content-digest.ts`).

- [x] **Step 1: Test puro que falla** — `applyDeviationsToSchedule`: `not_applicable` elimina; `reprogrammed` mueve y suma en destino; `withdrawn` no aplica; `not_performed` deja P. FAIL → implementar → PASS.
- [x] **Step 2: Tests PGlite que fallan** — "`not_applicable` baja `planned` del indicador y del documento RE-36 en esa faena, no en otra"; "`reprogrammed` mueve P de mar S2 a abr S1 y una ejecución aprobada en abr S1 acredita"; "`not_performed` mantiene P, E=0 y cuenta en `zeroActivities`"; "no se puede registrar `not_applicable` sobre celda con ejecución aprobada"; "registrar ejecución sobre `not_performed` lo retira con changelog"; "la huella del programa no cambia al registrar desvíos". FAIL → implementar → PASS.
- [x] **Step 3:** `npm run test:fast && npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-*.test.ts`. Commit `git commit -m "feat(pdtp): desvíos por celda aplicados en la costura única de planificación"`.

### Task 3.3: Estados, indicador, cola y RE-36

**Files:**
- Modify: `lib/services/pdtp/period.ts:76` (`PdtpActivityStatus` gana `"not_performed"`; `deriveActivityStatus(monthlyPlanned, monthlyExecuted, period, options?: { monthlyNotPerformed?: number[] })`; un mes anterior con `notPerformed > 0` no cuenta como atrasado; `countOverdueMonths` igual)
- Modify: `lib/services/pdtp/sheets.ts` (`PdtpSheetView.activities[]` gana `monthlyNotPerformed: number[]` y `deviations: Array<{ id; month; week; kind; reason; targetMonth; targetWeek }>`; agregada propaga)
- Modify: `lib/services/pdtp/compliance.ts` (`PdtpComplianceMonth.declaredNotPerformed: number`)
- Modify: `app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx` (`STATUS_BADGE.not_performed = { label: "No realizada (con motivo)", variant: "warning" }`), `pdtp-sheet-table.tsx` (tooltip del desvío en la celda semanal)
- Modify: `lib/services/pdtp/re36-document.ts` (`not_performed` → `e: 0` + `note` motivo; `not_applicable` → `p: null` + `note`; `reprogrammed` → nota en origen y destino; `deviations` llenas) y el renderer (hoja "Desvíos" con filas; `cell.note` en celdas)
- Modify: `lib/services/operational-work-queue.ts:920-934` (`NOT EXISTS` sobre `pdtp_execution_deviations` activos del mes), `lib/services/pdtp/reminders.ts` (`findPdtpWeeklyPending` igual)
- Modify: `lib/services/pdtp/management-report.ts` (`PdtpManagementReportActivityRow.deviations: { notPerformed; notApplicable; reprogrammed }`)
- Tests: `lib/services/pdtp/period.test.ts` (o el existente), `lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts` ("una actividad con `not_applicable` este mes no aparece en la cola"), `lib/reports/pdtp-re36-workbook.test.ts` ("celda no realizada = 0 con nota; hoja Desvíos con una fila"), `pdtp-sheet-table-ui.test.tsx`

- [x] **Step 1:** Escribir los tests listados → FAIL → implementar cada punto → PASS. `npm run test:fast`, pglite PDTP, `typecheck`, `lint`.
- [x] **Step 2: Commit** — `git commit -m "feat(pdtp): estado 'no realizada', desvíos en indicador, cola, reporte y RE-36"`.

### Task 3.4: Acciones y UI de desvíos

**Files:**
- Create: `app/(app)/prevencion/pdtp/actions/deviations.ts` (`recordPdtpDeviationAction(formData)` — guard: `not_performed` → `prevention:pdtp:execute`; `not_applicable`/`reprogrammed` → `prevention:pdtp:override:manage`; `withdrawPdtpDeviationAction`), re-export en `actions.ts`
- Create: `app/(app)/prevencion/pdtp/pdtp-deviation-form.tsx` (+ `.test.tsx`): selector de tipo, motivo (≥10), destino mes/semana solo para reprogramar; montado en `pdtp-sheet-table.tsx` junto a `PdtpExecutionForm` en la vista semanal por faena; lista de desvíos del mes bajo la fila con "Retirar"
- Modify: `app/(app)/prevencion/pdtp/[programId]/reporte/page.tsx` (columna "Desvíos")
- Create: `e2e/pdtp-desvios.spec.ts`

- [x] **Step 1:** Test de componente: "elegir Reprogramar muestra mes/semana destino; No realizada no"; "envía `kind`, `reason`, celda". FAIL → implementar → PASS.
- [x] **Step 2: E2E** — en `/prevencion/pdtp/actividades?programa=pdtp-prog-e2e&faena=ws-e2e&vista=semana` marcar "No realizada" con motivo y ver el badge; exportar RE-36 y comprobar E=0 con nota en esa celda. Verde.
- [x] **Step 3: Commit** — `git commit -m "feat(pdtp): registrar y retirar desvíos por celda desde la vista semanal"`.

**Aceptación Fase 3:** tres tipos de desvío reflejados en estado, indicador, cola, reporte y RE-36; `contentDigest` inalterado por desvíos.

---

## Fase 4 — Cierre de mes (G4) y distribución por correo (G7)

### Task 4.1: Tabla `pdtp_period_closures`, permiso y tipo de notificación

**Files:**
- Modify: `db/schema/prevention/pdtp.ts` (tabla), `db/schema/audit.ts:52` (`NotificationType` + `"pdtp_period_closed"`), `modules/prevention/manifest.ts` (`prevention:pdtp:close_period`: "Cerrar y reabrir el mes del Programa de Trabajo Preventivo por faena, congelando su foto"; grants `prevencionista`, `prevencionista_faena`, `administrador`), `ARCHITECTURE.md` (conteo de permisos)
- Create: `db/migrations/0303_*.sql`; Modify: `db/__tests__/pdtp-check-constraints.test.ts`

Columnas: `id` PK (`pdtp-close-${programId}-${worksiteId}-${year}-${MM}`); `programId` FK cascade; `worksiteId` FK restrict; `year` (2024–2100); `month` (1–12); `status` CHECK `('closed','reopened')`; `version` ≥ 1; `snapshotJson` jsonb NOT NULL; `digest` CHECK `length = 64`; `closedByUserId` NOT NULL, `closedAt`, `closeReason` (≥10); `reopenedByUserId`, `reopenedAt`, `reopenReason` con CHECK como en desvíos; `distributedAt` NULL; `distributionJson` jsonb default `[]`; `createdAt`, `updatedAt`; unique `(programId, worksiteId, year, month)`.

- [x] **Step 1:** Tests de CHECK (mes 13; digest corto; `reopened` sin motivo). FAIL → esquema + manifest + ARCHITECTURE → migración → PASS; `npx vitest run lib/__tests__/architecture-doc-rbac.test.ts` verde. Commit `git commit -m "feat(pdtp): cierres mensuales por faena (tabla, permiso y notificación)"`.

### Task 4.2: Servicio de cierre y bloqueo de escrituras

**Files:**
- Create: `lib/services/pdtp/period-closures.ts`, `lib/__tests__/pdtp-period-closures.test.ts` (PGlite; registrar)
- Modify: `lib/services/pdtp/executions.ts` (`markPdtpExecution`, `approvePdtpExecution`, `rejectPdtpExecution`), `lib/services/pdtp/deviations.ts` (`record`, `withdraw`), `lib/services/pdtp/overrides.ts` (`setPdtpActivityOverride`): llaman `assertPdtpPeriodOpen(programId, worksiteId, year, month, tx)` (para `reprogrammed`: origen **y** destino)
- Modify: `lib/validation/prevention-module/pdtp.ts` (`closePdtpPeriodSchema`, `reopenPdtpPeriodSchema`)

**Interfaces:**
```ts
export type PdtpPeriodClosureSnapshot = {
  schemaVersion: 1
  cutoff: { year: number; month: number; asOf: string }
  re36: PdtpRe36Document
  indicators: PdtpComplianceIndicators
  integral: PdtpIntegralCompliance | null
  managementReport: PdtpManagementReport      // filters { monthFrom: 1, monthTo: month }
  deviations: PdtpRe36DeviationRow[]
  objectives: Array<{ code: string; name: string; planned: number; executed: number; percent: number | null }>
  programVersion: { version: number; contentDigest: string | null }
}
export function pdtpPeriodClosureId(programId: string, worksiteId: string, year: number, month: number): string
export async function buildPdtpPeriodClosureSnapshot(input: { programId: string; worksiteId: string; year: number; month: number; scope: WorksiteScope }): Promise<PdtpPeriodClosureSnapshot>
export async function closePdtpPeriod(input: unknown, userId: string, scope: WorksiteScope): Promise<PdtpPeriodClosure>
export async function reopenPdtpPeriod(input: { closureId: string; reason: string }, userId: string, scope: WorksiteScope): Promise<PdtpPeriodClosure>
export async function listPdtpPeriodClosures(programId: string, scope: WorksiteScope, worksiteId?: string): Promise<Array<PdtpPeriodClosure & { worksiteName: string; closedByName: string }>>
export async function getPdtpPeriodClosure(closureId: string, scope: WorksiteScope): Promise<(PdtpPeriodClosure & { driftedSinceClose: boolean }) | null>
export async function assertPdtpPeriodOpen(programId: string, worksiteId: string, year: number, month: number, client?: Tx | typeof db): Promise<void>
```
Reglas (patrón `closeSafetyIndicatorPeriod`, `lib/services/prevention-indicadores.ts:760-810`): programa activo; faena operable y en alcance; `(year, month)` ≤ período actual y ≥ activación; transacción: snapshot → digest sha256 del JSON canónico (`stableJson` si existe en el repo; si no, `JSON.stringify` con claves ordenadas) → `INSERT … ON CONFLICT DO UPDATE` con `version + 1` y limpieza de reapertura; changelog sección `closure:${year}-${MM}`; `recordAudit` `action: "close"`. `reopen` conserva el snapshot. `driftedSinceClose` recalcula el snapshot y compara digest (solo en detalle). La acreditación por integración (`accreditPdtpFromEvent`) **no** se bloquea.

- [x] **Step 1: Tests que fallan** — "cerrar crea snapshot con re36, indicadores, desvíos y objetivos, y digest de 64"; "cerrar dos veces incrementa `version` y reemplaza el snapshot"; "mes cerrado rechaza `markPdtpExecution`, `approve`, `recordPdtpDeviation` y `setPdtpActivityOverride`"; "reabrir exige motivo ≥10 y vuelve a permitir escrituras"; "acreditación por integración sigue pasando y `driftedSinceClose` es true"; "no se cierra un mes futuro ni anterior a la activación"; "faena fuera de alcance → error".
- [x] **Step 2:** FAIL → implementar → PASS. Commit `git commit -m "feat(pdtp): cerrar y reabrir el mes por faena con foto congelada"`.

### Task 4.3: Distribución por notificación/correo (G7)

**Files:**
- Create: `lib/services/pdtp/period-closure-distribution.ts`, `lib/__tests__/pdtp-closure-distribution.test.ts` (PGlite; registrar)

**Interfaces:**
```ts
export const PDTP_CLOSURE_DISTRIBUTION_ROLES = ["jefa_chome", "prevencionista", "subgerente_operaciones", "gerente_legal_rrhh", "admin_contrato", "prevencionista_faena"] as const
export async function resolvePdtpClosureRecipients(worksiteId: string): Promise<Array<{ userId: string; email: string }>>
export async function distributePdtpPeriodClosure(input: { closureId: string }, userId: string, scope: WorksiteScope): Promise<{ recipients: number }>
```
Destinatarios: usuarios con `prevention:pdtp:view` en la faena (helper de `lib/services/pdtp/reminders.ts`) ∩ roles de la lista. Envío vía `createNotifications(userIds, { type: "pdtp_period_closed", title: \`Cierre PDTP ${MM}/${year} · ${faena}\`, body: "<% del mes>, <N> en cero, <M> desvíos", entityType: "pdtp_period_closure", entityId, entityHref: \`/prevencion/pdtp/${programId}/cierres/${closureId}\`, dedupeKey: \`pdtp-closure-${closureId}-v${version}\` })` (`lib/services/notification-create.ts:113` envía el correo). Registra `distributedAt` y `distributionJson`. Sin adjunto (fuera de alcance; el correo enlaza al detalle con descarga).

- [x] **Step 1: Tests que fallan** — "destinatarios = usuarios con `view` en la faena y rol de la lista"; "dedupe por `closureId+version` no reenvía"; "registra `distributedAt`". FAIL → implementar → PASS. Commit `git commit -m "feat(pdtp): distribuir el cierre mensual por notificación y correo"`.

### Task 4.4: Route de export del cierre, acciones y UI

**Files:**
- Create: `app/api/prevencion/pdtp/cierres/[closureId]/export/route.ts` (+ `.test.ts`): `prevention:pdtp:view` + `assertWorksiteAccess`; `renderPdtpRe36Buffer(closure.snapshotJson.re36, { session })` con hoja adicional "Cierre" (corte, motivo, quién cerró, digest); filename `RE-36-PDTP-${year}-${MM}-${worksite.code}-cierre-v${version}.xlsx`
- Create: `app/(app)/prevencion/pdtp/actions/period-closures.ts` (`closePdtpPeriodAction`, `reopenPdtpPeriodAction`, `distributePdtpPeriodClosureAction`; guard `prevention:pdtp:close_period`)
- Create: `app/(app)/prevencion/pdtp/[programId]/period-close-button.tsx` (+ `.test.tsx`; patrón `app/(app)/prevencion/indicadores/indicator-period-close-button.tsx`: mes/año default = mes anterior, motivo, checkbox "Distribuir por correo")
- Create: `app/(app)/prevencion/pdtp/[programId]/cierres/page.tsx` (lista: mes, versión, estado, cerrado por, descarga, "Reenviar", "Reabrir") y `cierres/[closureId]/page.tsx` (KPI congelados, objetivos, desvíos, drift)
- Modify: `app/(app)/prevencion/pdtp/[programId]/page.tsx` (botón y enlace "Cierres"), `app/(app)/prevencion/pdtp/page.tsx` (texto "Último cierre: MM/AAAA"), `modules/prevention/manifest.ts:302-345` (hijo "Cierres mensuales" con `prevention:pdtp:view`)
- Create: `e2e/pdtp-cierre-mes.spec.ts`

- [x] **Step 1:** Tests de route (403 sin permiso; 200 con `content-disposition` correcto) y de botón (mes por defecto = anterior; motivo obligatorio). FAIL → implementar → PASS.
- [x] **Step 2: E2E** — cerrar el mes anterior en `pdtp-prog-e2e`/`ws-e2e`, ver fila en `/cierres`, descargar, intentar registrar ejecución en ese mes y ver el error, reabrir. Verde.
- [x] **Step 3: Commit** — `git commit -m "feat(pdtp): pantalla de cierres mensuales, export del cierre y distribución"`.

**Aceptación Fase 4:** el snapshot embebe objetivos y desvíos; el export del cierre se regenera desde el JSON sin tocar la BD viva; correo con dedupe; escrituras bloqueadas en meses cerrados.

---

## Fase 5 — Asignación nominal por faena (G5)

### Task 5.1: Tabla `pdtp_activity_worksite_assignees` y permiso

**Files:**
- Modify: `db/schema/prevention/pdtp.ts` (tabla; comentario: no entra en la huella, es operación), `modules/prevention/manifest.ts` (`prevention:pdtp:assignee:manage`: "Asignar nominalmente actividades del programa a personas de una faena"; grants `prevencionista`, `prevencionista_faena`, `admin_contrato`, `administrador`), `ARCHITECTURE.md`
- Create: `db/migrations/0304_*.sql`; Modify: `db/__tests__/pdtp-check-constraints.test.ts`

Columnas: `id` PK; `activityId` FK cascade; `worksiteId` FK cascade; `userId` FK restrict; `roleId` FK set null (informativo); `validFrom` date NOT NULL; `validUntil` date NULL con CHECK `valid_until IS NULL OR valid_until >= valid_from`; `note`; `createdByUserId`; `createdAt`, `updatedAt`; `uniqueIndex(activityId, worksiteId, userId).where(sql\`valid_until IS NULL\`)`; índices `(worksiteId, userId)`, `(activityId, worksiteId)`.

- [x] **Step 1:** Tests de CHECK/índice parcial. FAIL → esquema + manifest + doc → migración → PASS. Commit `git commit -m "feat(pdtp): asignación nominal de actividades por faena (tabla y permiso)"`.

### Task 5.2: Servicio, cola, recordatorios y RE-36

**Files:**
- Create: `lib/services/pdtp/assignees.ts`, `lib/__tests__/pdtp-assignees.test.ts` (PGlite; registrar)
- Modify: `lib/services/operational-work-queue.ts:848-980` (`LEFT JOIN LATERAL` a asignados vigentes en fecha de Chile; `native_assignee_user_id/name`; visibilidad `WHERE (asg.id IS NULL AND <match por rol>) OR asg.id = ${session.user.id}`)
- Modify: `lib/services/pdtp/reminders.ts` (`findPdtpWeeklyPending`: al asignado si existe; si no, al rol)
- Modify: `lib/services/pdtp/re36-document.ts` (`row.assigneeNames`; RESPONSABLES = "Sup, JT (Nombre)"; opción `porPersona: true` genera una hoja por asignado — réplica de la variante "POR CARGO")
- Tests: `lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts`, `lib/__tests__/pdtp-reminders-dedup.test.ts`, `lib/__tests__/pdtp-re36-document.test.ts`

**Interfaces:**
```ts
export async function listPdtpActivityAssignees(programId: string, worksiteId: string, opts?: { asOf?: string }): Promise<Array<{ activityId: string; userId: string; userName: string; roleLabel: string | null; validFrom: string; validUntil: string | null }>>
export async function listPdtpAssigneeCandidates(activityId: string, worksiteId: string): Promise<Array<{ userId: string; name: string; roleLabels: string[] }>>   // usuarios de worksite_users(worksiteId) o globales cuyos roles ∈ roles mapeados por responsibleSlugs (pdtp_responsible_catalog.roleName|operatedByRoleName) ∪ ejecutores de la actividad
export async function setPdtpActivityAssignees(input: { activityId: string; worksiteId: string; userIds: string[]; validFrom?: string; note?: string }, userId: string, scope: WorksiteScope): Promise<void>   // cierra vigencias no incluidas (validUntil = validFrom − 1 día), inserta nuevas; valida candidatos; changelog "assignee:{n}"
export async function resolvePdtpAssigneesForCell(activityId: string, worksiteId: string, date: string): Promise<Array<{ userId: string; userName: string }>>
```
Decisión: con asignado nominal, los demás del mismo rol **no** ven la fila en `/pendientes`; la vista de actividades muestra todo con chip "Asignada a: Nombre" y filtro `?asignado=yo`. Dos asignados (turnos) la ven ambos.

- [x] **Step 1: Tests que fallan** — "candidatos = usuarios de la faena con rol mapeado"; "set cierra la vigencia anterior y abre la nueva"; "usuario sin rol compatible → error"; "con asignado nominal, otro usuario del mismo rol no ve la fila y el asignado sí con `native_assignee_user_id`"; "sin asignado se mantiene visibilidad por rol"; "el recordatorio va al asignado"; "RESPONSABLES del RE-36 incluye el nombre".
- [x] **Step 2:** FAIL → implementar → PASS. Commit `git commit -m "feat(pdtp): asignados nominales en cola, recordatorios y RE-36"`.

### Task 5.3: Acción y UI de asignación

**Files:**
- Create: `app/(app)/prevencion/pdtp/actions/assignees.ts` (`setPdtpActivityAssigneesAction`, guard `prevention:pdtp:assignee:manage`)
- Create: `app/(app)/prevencion/pdtp/pdtp-assignee-picker.tsx` (+ `.test.tsx`): menú de fila "Asignar a…" en `pdtp-sheet-table.tsx` (vista anual con faena seleccionada), multi-select de candidatos, fecha de vigencia; columna "Asignado" en `[programId]/aplicabilidad`
- Modify: `app/(app)/prevencion/pdtp/actividades/page.tsx` (filtro `?asignado=yo`), `app/api/prevencion/pdtp/export/route.ts` (`?por_persona=1`)
- Modify: `e2e/setup-db.ts` (usuario `jt@e2e.chome.cl` con rol `jefe_terreno` y `worksite_users` a `ws-e2e`); Create: `e2e/pdtp-asignacion-nominal.spec.ts`

- [x] **Step 1:** Test de componente: lista candidatos y envía `userIds`. FAIL → implementar → PASS.
- [x] **Step 2: E2E** — asignar la actividad fixture al JT, iniciar sesión como él, ver la tarjeta en `/pendientes` con su nombre; exportar `?por_persona=1` y ver una hoja con su nombre. Verde.
- [x] **Step 3: Commit** — `git commit -m "feat(pdtp): asignar actividades a personas por faena y exportar por persona"`.

**Aceptación Fase 5:** dos JT en una faena ven solo lo suyo en la cola; el RE-36 "por persona" reproduce la variante Biodiversa; la huella no cambia al asignar.

---

## Fase 6 — E2E como gate reproducible

### Task 6.1: Suite completa verde dos veces seguidas

**Files:**
- Modify según fallos: `e2e/*.spec.ts`, `e2e/setup-db.ts` (fixtures idempotentes bajo el reset destructivo: objetivo, desvío, cierre previo, usuario JT)
- Create: `qa/reports/<fecha>-pdtp-e2e-gate.md`; Modify: `qa/reports/latest.md`, RUNBOOK (bloque "Gate E2E")

- [ ] **Step 1:** `npx playwright test e2e/pdtp-*.spec.ts e2e/prevencion-*.spec.ts` → corregir hasta verde.
- [ ] **Step 2:** `npm run test:e2e` completo, sin trabajo pesado en paralelo (advertencia de `VERIFICACION_AUDITORIA_2026-09-12.md:174-178`). Registrar `passed/failed/skipped/duración`. Repetir. Expected: 0 fallos en ambas.
- [ ] **Step 3:** Revisar reparto de los 4 shards de CI (`.github/workflows/ci.yml:453-530`) con los specs nuevos; documentar en el RUNBOOK que el gate exige 4/4 shards verdes.
- [ ] **Step 4:** Informe en `qa/reports/` con la tabla de las dos corridas y fila en `latest.md`. Commit `git commit -m "test(e2e): gate reproducible con los flujos PDTP nuevos"`.

**Aceptación Fase 6:** dos corridas completas consecutivas en verde localmente y 4/4 shards verdes en CI en el commit final.

---

## Interacciones y riesgos

| Interacción | Efecto | Mitigación |
|---|---|---|
| Objetivos entran en la huella (`schemaVersion 14`) | Programa activo local muestra drift tras el backfill | Esperado; el botón "Crear nueva versión" (Fase 0) lo resuelve; en producción el script corre antes de firmar |
| Overrides por faena están en la huella y solo aplican a programas activos | Reprogramar con overrides abriría revisión v+1 cada vez | Los desvíos viven en tabla propia (Fase 3), fuera de la huella |
| `not_applicable` baja P | Cambia denominador, totales SUM del RE-36 y "en cero" en esa faena | Una sola costura (`helpers.ts:176`); tests cruzados PGlite |
| `reprogrammed` hacia mes cerrado | Debe rechazarse | `assertPdtpPeriodOpen` sobre origen y destino |
| Cierre vs acreditación por integración | No se bloquea | `driftedSinceClose` en el detalle |
| `weeks` en reglas jsonb ya guardadas | Deben proyectar igual | Test de fingerprints históricos (Task 2.1) |
| Masivo vs `expectedScheduleFingerprint` del autosave | Filas abiertas con huella obsoleta | `router.refresh()` y re-adopción existente |
| Asignado nominal vs cola por rol | Otros del rol dejan de ver la fila | Decisión explícita; filtro `?asignado=yo` en actividades |
| RE-36 totales ≠ indicador plataforma | Excel: E/P por semana sin tope; plataforma: tope mensual + cobertura | Fila "Indicador plataforma" y nota en el bloque de totales |
| `xlsxToBase64` sanitiza fórmulas | Reescribiría `{formula}` como texto | El renderer usa `writeBuffer` y sanitiza textos al armar el documento |
| Permisos nuevos | `architecture-doc-rbac.test.ts` falla | Tarea explícita en 4.1 y 5.1 |
| Trabajo ajeno en el árbol (auth) | Mezclarlo contaminaría los commits PDTP | Task 0.1 separa por grupos y pide confirmación |

## Verificación end-to-end

1. Por tarea: `npm run typecheck && npm run lint && npm run test:fast` y la suite PGlite indicada (`npx vitest run --config vitest.pglite.config.ts <archivos>`).
2. Por fase: `npm run db:verify-migrations`; specs E2E de la fase; recorrido manual en `npm run dev` con el programa 2026 local (faena Biodiversa): exportar RE-36 y abrir en LibreOffice; aplicar presets; registrar un desvío; cerrar un mes y recibir la notificación; asignar una actividad y verla en `/pendientes` como ese usuario.
3. Final: `npm run test:e2e` ×2 verdes, informe en `qa/reports/`, y actualizar `PDTP_COMPARATIVA_EXCEL_VS_MODULO_2026-09-16.md` §5 marcando cada brecha como cerrada con el commit.

## Fuera de alcance (explícito)

- Cambiar la fórmula de compensación mensual (decisión: solo exponer).
- Semanas ISO reales en `pdtp_activity_schedule` (CHECK 1–4 se mantiene).
- Adjuntar el Excel al correo (el `sendEmail` actual no expone adjuntos; el correo enlaza al detalle).
- Rehacer la interfaz según el documento derivado del Excel.
