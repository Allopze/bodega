/**
 * lib/__tests__/pdtp-indicators-reopen-revocation.test.ts
 *
 * Reabrir un período de indicadores tiene que deshacer la acreditación de la
 * N°7 que su cierre produjo.
 *
 * El par estuvo roto de dos maneras a la vez. La visible: `onSafetyIndicator
 * PeriodReopened` no tenía un solo llamador, así que reabrir y volver a cerrar
 * un mes contaba la actividad dos veces. La que nadie había mirado: el conector
 * sellaba la revocación con `indicadores:${worksiteId}` mientras el cierre usa
 * `indicadores:${snapshotId}`, y la revocación busca por coincidencia exacta —
 * cableado tal cual habría revocado **cero** ejecuciones y habría dejado un
 * evento `revoked` en el libro afirmando algo que no ocurrió.
 *
 * De ahí que el caso central de esta suite sea la clave, no el cableado.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { chileDateParts } = await import("@/lib/utils")
const {
  onSafetyIndicatorPeriodClosed,
  onSafetyIndicatorPeriodReopened,
} = await import("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors")
const { invalidateClosedIndicatorPeriod } = await import("@/lib/services/prevention-indicadores")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-ind-v1"
const ACTIVITY_ID = `${PROGRAM_ID}-a-007`
const USER_ID = "user-ind-1"
const WS_ID = "ws-ind-1"
const SNAPSHOT_ID = "snap-ind-1"
const MONTH = 5

async function executions() {
  return inMemoryDb.select().from(schema.pdtpExecutions)
    .where(eq(schema.pdtpExecutions.activityId, ACTIVITY_ID))
}

async function seedClosedPeriod() {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.safetyIndicatorSnapshots).values({
    id: SNAPSHOT_ID, worksiteId: WS_ID, periodType: "monthly", year: PROGRAM_YEAR,
    startMonth: MONTH, endMonth: MONTH, formulaVersion: "1", sourceHashSha256: "a".repeat(64),
    inputSnapshot: { incidentIds: [], personCaseKeys: [], denominatorIds: [], denominatorVersions: [] },
    resultSnapshot: {
      status: "confirmed", accidents: 0, injuredPeople: 0, absenceDays: 0, chargeDays: 0,
      workerAverage: 0, workedHours: 0, accidentabilityRate: 0, frequencyRate: 0, severityRate: 0,
    },
    status: "approved", reconciliationStatus: "matched",
    createdByUserId: USER_ID, createdAt: now,
    // El CHECK `safety_indicator_snapshot_approval_check` exige, para un
    // snapshot aprobado, aprobador, fecha, motivo, cero casos pendientes y
    // conciliación `matched`.
    approvedByUserId: USER_ID, approvedAt: now, approvalReason: "Snapshot aprobado para la prueba.",
  })
  await inMemoryDb.insert(schema.safetyIndicatorPeriods).values({
    id: `sip-${WS_ID}-${PROGRAM_YEAR}-${String(MONTH).padStart(2, "0")}`,
    worksiteId: WS_ID, year: PROGRAM_YEAR, month: MONTH,
    closedByUserId: USER_ID, closedAt: now, status: "closed", snapshotId: SNAPSHOT_ID,
    closeReason: "Cierre del período para la prueba.", version: 1,
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  // La bitácora referencia la faena y el período; se borra primero.
  await inMemoryDb.delete(schema.safetyIndicatorHistory)
  await inMemoryDb.delete(schema.safetyIndicatorPeriods)
  await inMemoryDb.delete(schema.safetyIndicatorSnapshots)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-ind@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Indicadores", code: "FI", isActive: true })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} indicadores`,
    status: "active", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACTIVITY_ID, programId: PROGRAM_ID, n: 7,
    activity: "Envío de estadística de cada faena", program: "Indicadores",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    sourceSheetRow: 7, createdAt: now, updatedAt: now,
  })
})

describe("la revocación de la N°7 comparte clave con su acreditación", () => {
  it("reabrir con el snapshot del cierre revoca la ejecución", async () => {
    await onSafetyIndicatorPeriodClosed({
      worksiteId: WS_ID, snapshotId: SNAPSHOT_ID, year: PROGRAM_YEAR, month: MONTH,
      closedAt: new Date().toISOString(),
    })
    const [acreditada] = await executions()
    expect(acreditada).toBeDefined()
    expect(acreditada!.sourceId).toBe(`indicadores:${SNAPSHOT_ID}`)
    expect(acreditada!.status).toBe("submitted")

    await onSafetyIndicatorPeriodReopened({
      worksiteId: WS_ID, snapshotId: SNAPSHOT_ID, year: PROGRAM_YEAR, month: MONTH,
      reason: "El denominador aprobado se corrigió.",
    })

    // El motor no inventa un estado `revoked`: devuelve la ejecución a `draft`
    // —fuera del conteo— y sella el motivo en el metadato.
    const [revocada] = await executions()
    expect(revocada!.status).toBe("draft")
    expect((revocada!.sourceMetadataJson as Record<string, unknown>).revokedAt).toBeTruthy()
    expect((revocada!.sourceMetadataJson as Record<string, unknown>).revocationReason)
      .toBe("El denominador aprobado se corrigió.")
  })

  it("una clave que no es la del cierre no revoca nada — el defecto original", async () => {
    // Es la regresión exacta: el conector sellaba con el id de la faena. Si
    // alguien lo vuelve a hacer, esta ejecución seguiría viva y el libro
    // registraría una revocación que no ocurrió.
    await onSafetyIndicatorPeriodClosed({
      worksiteId: WS_ID, snapshotId: SNAPSHOT_ID, year: PROGRAM_YEAR, month: MONTH,
      closedAt: new Date().toISOString(),
    })
    await onSafetyIndicatorPeriodReopened({
      worksiteId: WS_ID, snapshotId: WS_ID, year: PROGRAM_YEAR, month: MONTH,
      reason: "Clave equivocada, a propósito.",
    })

    const [sinRevocar] = await executions()
    expect(sinRevocar!.status).toBe("submitted")
    expect((sinRevocar!.sourceMetadataJson as Record<string, unknown>).revokedAt).toBeUndefined()
  })
})

describe("invalidateClosedIndicatorPeriod", () => {
  it("devuelve qué revocar y dispara después del commit", async () => {
    await seedClosedPeriod()
    await onSafetyIndicatorPeriodClosed({
      worksiteId: WS_ID, snapshotId: SNAPSHOT_ID, year: PROGRAM_YEAR, month: MONTH,
      closedAt: new Date().toISOString(),
    })

    const result = await invalidateClosedIndicatorPeriod({
      worksiteId: WS_ID,
      occurredAt: `${PROGRAM_YEAR}-${String(MONTH).padStart(2, "0")}-15T12:00:00.000Z`,
      actorUserId: USER_ID,
      reason: "Se reclasificó a una persona del período ya cerrado.",
      permissions: ["prevention:indicadores:close"],
    })

    expect(result.reopened).toBe(true)
    expect(result.revocation).toMatchObject({ worksiteId: WS_ID, snapshotId: SNAPSHOT_ID })

    // El período quedó reabierto y la acreditación revocada: las dos cosas, y
    // la segunda con la transacción de la primera ya cerrada.
    const [periodo] = await inMemoryDb.select().from(schema.safetyIndicatorPeriods)
      .where(and(
        eq(schema.safetyIndicatorPeriods.worksiteId, WS_ID),
        eq(schema.safetyIndicatorPeriods.year, PROGRAM_YEAR),
      ))
    expect(periodo!.status).toBe("reopened")
    const [ejecucion] = await executions()
    expect(ejecucion!.status).toBe("draft")
    expect((ejecucion!.sourceMetadataJson as Record<string, unknown>).revokedAt).toBeTruthy()
  })

  it("un período que nunca se cerró no dispara nada", async () => {
    const result = await invalidateClosedIndicatorPeriod({
      worksiteId: WS_ID,
      occurredAt: `${PROGRAM_YEAR}-${String(MONTH).padStart(2, "0")}-15T12:00:00.000Z`,
      actorUserId: USER_ID,
      reason: "No hay período cerrado que invalidar.",
      permissions: ["prevention:indicadores:close"],
    })

    expect(result).toEqual({ reopened: false, revocation: null })
    expect(await executions()).toHaveLength(0)
  })

  it("un período cerrado sin snapshot no tiene nada que revocar", async () => {
    // Sin snapshot no hubo acreditación: la N°7 se sella con su id.
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.safetyIndicatorPeriods).values({
      id: `sip-${WS_ID}-sin-snapshot`, worksiteId: WS_ID, year: PROGRAM_YEAR, month: MONTH,
      closedByUserId: USER_ID, closedAt: now, status: "closed", snapshotId: null,
      closeReason: "Cierre heredado sin snapshot.", version: 1,
    })

    const result = await invalidateClosedIndicatorPeriod({
      worksiteId: WS_ID,
      occurredAt: `${PROGRAM_YEAR}-${String(MONTH).padStart(2, "0")}-15T12:00:00.000Z`,
      actorUserId: USER_ID,
      reason: "Se reclasificó a una persona del período ya cerrado.",
      permissions: ["prevention:indicadores:close"],
    })

    expect(result.reopened).toBe(true)
    expect(result.revocation).toBeNull()
  })
})
