/** Real PostgreSQL proof for Gestión del cambio: disponibilidad, segregación de aprobación y derivación a CAPA por dimensión. */
import path from "node:path"
import postgres from "postgres"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { CHANGE_DIMENSIONS } from "@/lib/prevention/change"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_CHANGE_DATABASE_URL
const canReset = process.env.PREVENTION_CHANGE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-chg-a"] } as WorksiteScope
const MANAGER = { userId: "chg-manager", scope: scopeA, permissions: ["prevention:change:view", "prevention:change:manage", "prevention:change:evaluate"] }
const APPROVER = { userId: "chg-approver", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:change:view", "prevention:change:approve"] }
const MANAGER_WITH_APPROVE = { userId: "chg-manager", scope: scopeA, permissions: ["prevention:change:view", "prevention:change:manage", "prevention:change:evaluate", "prevention:change:approve"] }
const OUTSIDER = { userId: "chg-outsider", scope: { mode: "some", ids: ["ws-chg-b"] } as WorksiteScope, permissions: ["prevention:change:view", "prevention:change:manage"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

/**
 * MOC-05: la fecha de revisión posterior ahora se valida contra el día de la
 * aprobación y tiene tope de 24 meses, así que una fecha fija en el calendario
 * dejaba de ser válida con sólo mirar el reloj. Relativa a la corrida.
 */
const REVIEW_DATE = addDaysToPlainDate(todayInChile(), 90)

/** La versión se relee siempre: evaluar una dimensión la incrementa (MOC-02). */
async function readVersion(changeId: string) {
  const [row] = await getDb().select().from(schema.preventionChangeRequests)
    .where(eq(schema.preventionChangeRequests.id, changeId))
  return row!.version
}

describeIf("Gestión del cambio on real PostgreSQL", () => {
  let changeId = ""

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_CHANGE" })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1, onnotice: () => undefined })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()
    client = postgres(databaseUrl!, { max: 10, onnotice: () => undefined })
    testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    await client?.end()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it("denies creating a change request from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.createChangeRequest({
      worksiteId: "ws-chg-a", title: "Cambio ajeno", changeType: "proceso",
      description: "Cambio de procedimiento de carga.", reason: "Optimización operacional.",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates the change request in draft with the six dimensions pending", async () => {
    const service = await import("@/lib/services/prevention-change")
    const request = await service.createChangeRequest({
      worksiteId: "ws-chg-a", title: "Cambio de proveedor de aislamiento eléctrico", changeType: "proveedor",
      description: "Se cambia el proveedor que suministra los equipos de aislamiento (LOTO).",
      reason: "El proveedor anterior discontinuó la línea de candados certificados.",
      riskLevel: "high",
    }, MANAGER)
    changeId = request.id
    expect(request.status).toBe("draft")

    const assessments = await getDb().select().from(schema.preventionChangeAssessments)
      .where(eq(schema.preventionChangeAssessments.changeRequestId, changeId))
    expect(assessments).toHaveLength(CHANGE_DIMENSIONS.length)
    expect(assessments.every((row) => row.evaluated === false)).toBe(true)
  })

  it("refuses to approve a change with no dimension evaluated", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: await readVersion(changeId), plannedReviewDate: REVIEW_DATE,
    }, APPROVER)).rejects.toThrow(/Faltan por evaluar/)
  })

  it("evaluating a dimension moves the request to under_evaluation and bumps its version", async () => {
    const service = await import("@/lib/services/prevention-change")
    const before = await readVersion(changeId)
    await service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "training", impacted: true,
      notes: "Se requiere reentrenar en el uso del nuevo candado.", actionRequired: false,
    }, MANAGER)

    const [request] = await getDb().select().from(schema.preventionChangeRequests).where(eq(schema.preventionChangeRequests.id, changeId))
    expect(request?.status).toBe("under_evaluation")
    expect(request?.version).toBe(before + 1)
  })

  it("deriving an action from a dimension links a CAPA action with responsible and target date", async () => {
    const service = await import("@/lib/services/prevention-change")
    const updated = await service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "permit", impacted: true,
      notes: "Los permisos de trabajo eléctrico deben referenciar el nuevo candado.",
      actionRequired: true, actionDescription: "Actualizar el catálogo de tipos de permiso con el nuevo candado.",
      responsibleUserId: "chg-manager", priority: "high", targetDate: "2026-11-01",
    }, MANAGER)
    expect(updated.capaActionId).toBeTruthy()

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "change"))
    expect(capa).toHaveLength(1)
    expect(capa[0]?.sourceId).toBe(changeId)
    expect(capa[0]?.worksiteId).toBe("ws-chg-a")
    expect(capa[0]?.targetDate).toBe("2026-11-01")
  })

  /**
   * MOC-04: la combinación "no impacta pero requiere acción" la rechaza el
   * borde con un error de campo, y el CHECK sigue siendo la garantía — una
   * escritura que se salte el servicio tampoco puede dejarla en la tabla.
   */
  it("refuses an action on a non-impacted dimension at the edge and keeps the CHECK underneath", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "document", impacted: false,
      actionRequired: true, actionDescription: "Acción sobre una dimensión declarada sin impacto.",
      targetDate: "2026-11-01",
    }, MANAGER)).rejects.toThrow(/declararse impactada/)

    // La dimensión `permit` quedó con acción y CAPA: bajarle `impacted` deja
    // exactamente la combinación prohibida sin tocar el otro CHECK.
    const [assessment] = await getDb().select().from(schema.preventionChangeAssessments)
      .where(and(
        eq(schema.preventionChangeAssessments.changeRequestId, changeId),
        eq(schema.preventionChangeAssessments.dimension, "permit"),
      ))
    const failure = await client!`UPDATE prevention_change_assessments SET impacted = false WHERE id = ${assessment!.id}`
      .then(() => null, (error: Error) => error)
    expect(String(failure)).toMatch(/prevention_change_assessment_impact_consistent/)
  })

  it("still refuses approval while four dimensions remain unevaluated", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: await readVersion(changeId), plannedReviewDate: REVIEW_DATE,
    }, APPROVER)).rejects.toThrow(/Faltan por evaluar/)
  })

  it("evaluating the remaining dimensions unblocks approval", async () => {
    const service = await import("@/lib/services/prevention-change")
    for (const dimension of ["risk", "document", "miper", "emergency"] as const) {
      await service.evaluateChangeDimension({
        changeRequestId: changeId, dimension, impacted: false, actionRequired: false,
      }, MANAGER)
    }
    const detail = await service.getChangeRequestDetail(changeId, MANAGER)
    expect(detail?.readiness.ready).toBe(false) // aún falta la fecha de revisión, que se declara al aprobar
    expect(detail?.assessments.every((row) => row.evaluated)).toBe(true)
  })

  /**
   * MOC-02: la aprobación viaja con la versión leída al abrir la pantalla. Si
   * entremedio se reevalúa una dimensión, el expediente ya no es el que se
   * revisó y el compare-and-swap debe rechazarla — no aprobar sobre una
   * evaluación obsoleta.
   */
  it("refuses approval carrying the version read before a re-evaluation (TOCTOU)", async () => {
    const service = await import("@/lib/services/prevention-change")
    const staleVersion = await readVersion(changeId)
    await service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "risk", impacted: true,
      notes: "El candado del nuevo proveedor obliga a revisar el riesgo eléctrico.", actionRequired: false,
    }, MANAGER)
    expect(await readVersion(changeId)).toBeGreaterThan(staleVersion)

    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: staleVersion, plannedReviewDate: REVIEW_DATE,
    }, APPROVER)).rejects.toThrow(/cambió mientras/)
  })

  it("refuses approval by the requester, even holding the approve permission", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: await readVersion(changeId), plannedReviewDate: REVIEW_DATE,
    }, MANAGER_WITH_APPROVE)).rejects.toThrow(/no puede aprobarlo/)
  })

  it("approves the change once every dimension is evaluated and a review date is set", async () => {
    const service = await import("@/lib/services/prevention-change")
    const approved = await service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: await readVersion(changeId), plannedReviewDate: REVIEW_DATE,
    }, APPROVER)
    expect(approved.status).toBe("approved")
    expect(approved.plannedReviewDate).toBe(REVIEW_DATE)
    expect(approved.approvedByUserId).toBe("chg-approver")
  })

  /**
   * MOC-05: la fecha de revisión se guardaba y no la leía nadie, así que llegado
   * el día no pasaba nada. Ahora alimenta la bandeja de Prevención, tras SU
   * propio permiso — no el de higiene ni el de emergencias (EMERGENCIAS-08).
   */
  it("surfaces the approved change in the prevention inbox when its review date comes due", async () => {
    const { getPreventionAttention } = await import("@/lib/services/prevention-attention")
    const base = {
      worksiteIds: ["ws-chg-a"],
      includeActions: false, includeEvaluations: false, includePpa: false,
    }

    // A 90 días todavía no molesta: la ventana de la bandeja es de 30.
    expect(await getPreventionAttention({ ...base, includeChangeReviews: true })).toEqual([])

    // Se adelanta la fecha a ayer, que es lo que hace el calendario solo.
    await client!`UPDATE prevention_change_requests SET planned_review_date = ${addDaysToPlainDate(todayInChile(), -1)} WHERE id = ${changeId}`

    const conPermiso = await getPreventionAttention({ ...base, includeChangeReviews: true })
    const aviso = conPermiso.find((item) => item.id === `change_review:${changeId}`)
    expect(aviso?.title).toBe("Revisión de cambio vencida")
    expect(aviso?.tone).toBe("danger")
    expect(aviso?.href).toBe(`/prevencion/gestion-cambio/${changeId}`)

    // Sin el permiso de cambios, el mismo aviso no existe.
    expect(await getPreventionAttention({ ...base, includeProtocols: true, includeEmergencyResources: true })).toEqual([])

    await client!`UPDATE prevention_change_requests SET planned_review_date = ${REVIEW_DATE} WHERE id = ${changeId}`
  })

  it("rejects evaluating a dimension once the change is already decided", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "risk", impacted: false, actionRequired: false,
    }, MANAGER)).rejects.toThrow(/ya decidido/)
  })

  /**
   * MOC-02, el orden inverso: la aprobación ya tomó la fila del cambio y
   * confirma mientras la evaluación está en vuelo. Sin `for("update")` la
   * evaluación leería el estado abierto, esperaría el lock en el bump y
   * escribiría igual, dejando un `evaluatedAt` posterior al `approvedAt` de un
   * cambio ya decidido.
   */
  it("rejects an evaluation started while an approval holds the change row", async () => {
    const service = await import("@/lib/services/prevention-change")
    const request = await service.createChangeRequest({
      worksiteId: "ws-chg-a", title: "Cambio con aprobación en vuelo", changeType: "equipo",
      description: "Reemplazo del tablero eléctrico de la sala de bombas.",
      reason: "El tablero actual quedó fuera de norma.",
    }, MANAGER)

    let release = () => {}
    const holdReleased = new Promise<void>((resolve) => { release = resolve })
    const approval = client!.begin(async (tx) => {
      await tx`SELECT id FROM prevention_change_requests WHERE id = ${request.id} FOR UPDATE`
      await holdReleased
      await tx`UPDATE prevention_change_requests
               SET status = 'approved', approved_by_user_id = 'chg-approver', approved_at = now(),
                   planned_review_date = '2026-12-01', version = version + 1
               WHERE id = ${request.id}`
    })

    // El rechazo se materializa de inmediato para no dejar una promesa sin
    // manejar mientras esperamos a que la aprobación suelte el lock.
    const evaluation = service.evaluateChangeDimension({
      changeRequestId: request.id, dimension: "risk", impacted: false, actionRequired: false,
    }, MANAGER).then(() => null, (error: Error) => error)

    await new Promise((resolve) => setTimeout(resolve, 250))
    release()
    await approval

    const outcome = await evaluation
    expect(outcome).toBeInstanceOf(Error)
    expect(outcome?.message).toMatch(/ya decidido/)

    const [assessment] = await getDb().select().from(schema.preventionChangeAssessments)
      .where(and(
        eq(schema.preventionChangeAssessments.changeRequestId, request.id),
        eq(schema.preventionChangeAssessments.dimension, "risk"),
      ))
    expect(assessment?.evaluatedAt).toBeNull()
  })

  /**
   * MOC-03: reevaluar una dimensión creaba una CAPA nueva cada vez y pisaba
   * `capaActionId`, dejando la anterior viva, sin dueño que la cerrara y
   * contando de a una por reevaluación en los tableros.
   */
  it("reconciles the derived CAPA on re-evaluation instead of duplicating it", async () => {
    const service = await import("@/lib/services/prevention-change")
    const request = await service.createChangeRequest({
      worksiteId: "ws-chg-a", title: "Cambio con dimensión reevaluada", changeType: "sustancia",
      description: "Reemplazo del desengrasante por uno de base acuosa.",
      reason: "El actual quedó fuera de la política de sustancias peligrosas.",
    }, MANAGER)

    const capasDelCambio = () => getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceId, request.id))

    const primera = await service.evaluateChangeDimension({
      changeRequestId: request.id, dimension: "risk", impacted: true,
      notes: "Cambia el riesgo químico del área de lavado.",
      actionRequired: true, actionDescription: "Actualizar la hoja de datos de seguridad del área.",
      responsibleUserId: "chg-manager", priority: "medium", targetDate: addDaysToPlainDate(todayInChile(), 30),
    }, MANAGER)
    expect(primera.capaActionId).toBeTruthy()
    expect(await capasDelCambio()).toHaveLength(1)

    // Reevaluar manteniendo la exigencia CONSERVA la acción y le traslada lo
    // reevaluado, en vez de abrir otra y abandonar ésta.
    const segunda = await service.evaluateChangeDimension({
      changeRequestId: request.id, dimension: "risk", impacted: true,
      notes: "Cambia el riesgo químico del área de lavado y también el de la bodega.",
      actionRequired: true, actionDescription: "Actualizar la hoja de datos de seguridad del área y de la bodega.",
      responsibleUserId: "chg-manager", priority: "high", targetDate: addDaysToPlainDate(todayInChile(), 45),
    }, MANAGER)
    expect(segunda.capaActionId).toBe(primera.capaActionId)
    expect(await capasDelCambio()).toHaveLength(1)

    const [reconducida] = await capasDelCambio()
    expect(reconducida?.priority).toBe("high")
    expect(reconducida?.targetDate).toBe(addDaysToPlainDate(todayInChile(), 45))
    expect(reconducida?.actionDescription).toContain("bodega")
    expect(reconducida?.status).toBe("pending")

    // Idempotente: una tercera reevaluación idéntica a la segunda no crea nada.
    await service.evaluateChangeDimension({
      changeRequestId: request.id, dimension: "risk", impacted: true,
      notes: "Cambia el riesgo químico del área de lavado y también el de la bodega.",
      actionRequired: true, actionDescription: "Actualizar la hoja de datos de seguridad del área y de la bodega.",
      responsibleUserId: "chg-manager", priority: "high", targetDate: addDaysToPlainDate(todayInChile(), 45),
    }, MANAGER)
    expect(await capasDelCambio()).toHaveLength(1)

    // Desmarcar la exigencia cancela la acción con motivo — no la borra ni la
    // deja colgando — y la dimensión queda sin acción.
    const desmarcada = await service.evaluateChangeDimension({
      changeRequestId: request.id, dimension: "risk", impacted: true,
      notes: "El control existente ya cubre el riesgo: no hace falta acción nueva.",
      actionRequired: false,
    }, MANAGER)
    expect(desmarcada.capaActionId).toBeNull()
    expect(desmarcada.actionRequired).toBe(false)

    const [cancelada] = await capasDelCambio()
    expect(await capasDelCambio()).toHaveLength(1)
    expect(cancelada?.status).toBe("cancelled")
    expect(cancelada?.cancellationReason).toContain("retiró la acción")

    // Y si la exigencia vuelve, nace una acción nueva: la anterior ya no sirve.
    const revivida = await service.evaluateChangeDimension({
      changeRequestId: request.id, dimension: "risk", impacted: true,
      notes: "Con la sustancia nueva sí cambia el control.",
      actionRequired: true, actionDescription: "Reemplazar la ficha de control del área de lavado.",
      responsibleUserId: "chg-manager", priority: "medium", targetDate: addDaysToPlainDate(todayInChile(), 60),
    }, MANAGER)
    expect(revivida.capaActionId).not.toBe(primera.capaActionId)
    expect(await capasDelCambio()).toHaveLength(2)
  })

  it("does not leak change requests of another worksite", async () => {
    const service = await import("@/lib/services/prevention-change")
    expect(await service.listChangeRequests(OUTSIDER)).toEqual([])
    expect(await service.getChangeRequestDetail(changeId, OUTSIDER)).toBeNull()
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-chg-a", name: "Faena Norte", code: "CHG-A", createdAt: now, updatedAt: now },
    { id: "ws-chg-b", name: "Faena Sur", code: "CHG-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "chg-manager", name: "Gestor de Cambios", email: "chg-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "chg-approver", name: "Aprobador", email: "chg-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "chg-outsider", name: "Ajeno", email: "chg-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally { await setupClient.end() }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1, onnotice: () => undefined })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally { await maintenanceClient.end() }
}
