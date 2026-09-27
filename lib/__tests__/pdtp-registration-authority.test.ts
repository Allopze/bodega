/**
 * lib/__tests__/pdtp-registration-authority.test.ts
 *
 * PREV-I03 (resto), auditoría 2026-09-26: sin asignación nominal, cualquiera
 * con `prevention:pdtp:execute` en la faena —incluidos roles globales no
 * operacionales como gerente_legal_rrhh, subgerente_operaciones o
 * jefe_mantencion— registraba cualquier actividad. Ahora registra lo propio:
 *
 * - con asignación nominal vigente, la persona asignada;
 * - sin ella, quien tiene el rol de alguno de los responsables de la actividad
 *   (o el rol que opera la plataforma por él, D21);
 * - Prevención y la administración del programa, cualquiera.
 *
 * La regla vive en el servicio y se aplica a los tres caminos de registro:
 * planilla (`markPdtpExecution`), reporte de obligación
 * (`reportPdtpObligation`) y envío de una ocurrencia programada
 * (`recordPdtpScheduledInstanceOutcome`).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts, todayInChile } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const previousStoragePath = process.env.STORAGE_PATH
const tmpEvidenceRoot = join(tmpdir(), `pdtp-registration-authority-${Date.now()}`)
process.env.STORAGE_PATH = tmpEvidenceRoot
mkdirSync(join(tmpEvidenceRoot, "pdtp-evidence"), { recursive: true })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = previousStoragePath
})

const { markPdtpExecution } = await import("@/lib/services/pdtp/executions")
const { createPdtpObligation, reportPdtpObligation } = await import("@/lib/services/pdtp/obligations")
const { recordPdtpScheduledInstanceOutcome } = await import("@/lib/services/pdtp/scheduled-execution")
const {
  decidePdtpRegistrationAuthority,
  listPdtpRegistrableActivityIds,
} = await import("@/lib/services/pdtp/registration-authority")

const { year: YEAR, month: CURRENT_MONTH } = chileDateParts()
const PROGRAM_ID = "pdtp-authority-v1"
const WS = "ws-authority"
const ACT_JT = `${PROGRAM_ID}-a-001`
const ACT_CONDUCTORES = `${PROGRAM_ID}-a-002`
const ACT_RETIRADO = `${PROGRAM_ID}-a-003`
const JT = "user-authority-jt"
const JT_2 = "user-authority-jt-2"
const LEGAL = "user-authority-legal"
const PREV = "user-authority-prev"

const JT_ACTOR = { userId: JT, roles: ["jefe_terreno"], canRegisterAnyActivity: false }
const JT_2_ACTOR = { userId: JT_2, roles: ["jefe_terreno"], canRegisterAnyActivity: false }
/** Rol global con `execute` que no responde por la actividad. */
const LEGAL_ACTOR = { userId: LEGAL, roles: ["gerente_legal_rrhh"], canRegisterAnyActivity: false }
const PREV_ACTOR = { userId: PREV, roles: ["prevencionista_faena"], canRegisterAnyActivity: true }

function evidenceFile(name: string): string {
  writeFileSync(join(tmpEvidenceRoot, "pdtp-evidence", name), "%PDF-1.4 test")
  return `storage/pdtp-evidence/${name}`
}

function cell(activityId: string, overrides: Record<string, unknown> = {}) {
  return {
    activityId, worksiteId: WS, year: YEAR, month: CURRENT_MONTH, week: 1,
    executedQuantity: 1, evidenceText: "", evidenceUrl: evidenceFile(`${activityId}-${Math.random().toString(36).slice(2)}.pdf`), evidencePhotos: [],
    ...overrides,
  }
}

async function executionOf(activityId: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpExecutions)
    .where(and(eq(schema.pdtpExecutions.activityId, activityId), eq(schema.pdtpExecutions.worksiteId, WS)))
  return row
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.operationalActivityEvents)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([JT, JT_2, LEGAL, PREV].map((id) => ({
    id, name: id, email: `${id}@test`, hashedPassword: "x",
  })))
  await inMemoryDb.insert(schema.worksites).values({ id: WS, name: "Faena autoridad", code: "FA", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "jt", displayName: "Jefe de terreno", roleName: "jefe_terreno", kind: "role", isActive: true },
    // Los conductores no tienen cuenta: opera el jefe de terreno por ellos (D21).
    { slug: "conductores", displayName: "Conductores", roleName: null, operatedByRoleName: "jefe_terreno", kind: "role", isActive: true },
    { slug: "retirado", displayName: "Cargo retirado", roleName: "jefe_terreno", kind: "role", isActive: false },
  ])
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: YEAR, title: `PDTP ${YEAR} autoridad`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedAt: `${YEAR}-01-01T00:00:00.000Z`, createdAt: now, updatedAt: now,
  })
  const base = {
    programId: PROGRAM_ID, program: "Prevención", scheduleMode: "scheduled" as const,
    scheduleClassificationStatus: "confirmed" as const, mechanism: "enganche", createdAt: now, updatedAt: now,
  }
  await inMemoryDb.insert(schema.pdtpActivities).values([
    { ...base, id: ACT_JT, n: 1, activity: "Charla de terreno", responsibleSlugs: ["jt"], responsibleDisplay: "Jefe de terreno", sourceSheetRow: 1 },
    { ...base, id: ACT_CONDUCTORES, n: 2, activity: "Report de uso diario", responsibleSlugs: ["conductores"], responsibleDisplay: "Conductores", sourceSheetRow: 2 },
    { ...base, id: ACT_RETIRADO, n: 3, activity: "Actividad de un cargo retirado", responsibleSlugs: ["retirado"], responsibleDisplay: "Cargo retirado", sourceSheetRow: 3 },
  ])
})

async function assign(activityId: string, userId: string) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values({
    id: `assignee-${activityId}-${userId}`, activityId, worksiteId: WS, userId,
    validFrom: `${YEAR}-01-01`, createdAt: now, updatedAt: now,
  })
}

describe("decidePdtpRegistrationAuthority — la regla sin base de datos", () => {
  const responsible = { roles: ["jefe_terreno"], names: ["Jefe de terreno"] }

  it("el rol responsable registra", () => {
    expect(decidePdtpRegistrationAuthority({ actor: JT_ACTOR, assigneeUserIds: [], responsible }).allowed).toBe(true)
  })

  it("un rol global que no responde por la actividad no registra, y el mensaje dice de quién es", () => {
    const verdict = decidePdtpRegistrationAuthority({ actor: LEGAL_ACTOR, assigneeUserIds: [], responsible })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed ? "" : verdict.message).toMatch(/Jefe de terreno/)
  })

  it("Prevención o la administración registran cualquier actividad, aun asignada a otro", () => {
    expect(decidePdtpRegistrationAuthority({ actor: PREV_ACTOR, assigneeUserIds: [JT], responsible }).allowed).toBe(true)
  })

  it("con asignación nominal manda la asignación: el responsable no asignado no registra", () => {
    const verdict = decidePdtpRegistrationAuthority({ actor: JT_2_ACTOR, assigneeUserIds: [JT], responsible })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed ? "" : verdict.message).toMatch(/asignada a otra persona/i)
  })

  it("una actividad sin responsable con rol sólo la registra Prevención", () => {
    const verdict = decidePdtpRegistrationAuthority({ actor: JT_ACTOR, assigneeUserIds: [], responsible: { roles: [], names: [] } })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed ? "" : verdict.message).toMatch(/Prevención/)
  })
})

describe("PREV-I03 — planilla (markPdtpExecution)", () => {
  it("el jefe de terreno registra la actividad que le toca por cargo", async () => {
    await markPdtpExecution(cell(ACT_JT), JT, "all", { actor: JT_ACTOR })
    expect((await executionOf(ACT_JT))?.executedByUserId).toBe(JT)
  })

  it("un rol global no operacional no registra una actividad ajena", async () => {
    await expect(markPdtpExecution(cell(ACT_JT), LEGAL, "all", { actor: LEGAL_ACTOR }))
      .rejects.toThrow(/Solo su responsable/)
    expect(await executionOf(ACT_JT)).toBeUndefined()
  })

  it("el rol que opera por un responsable sin cuenta registra (D21)", async () => {
    await markPdtpExecution(cell(ACT_CONDUCTORES), JT, "all", { actor: JT_ACTOR })
    expect((await executionOf(ACT_CONDUCTORES))?.executedByUserId).toBe(JT)
  })

  it("un responsable inactivo en el catálogo no le da la actividad a nadie", async () => {
    await expect(markPdtpExecution(cell(ACT_RETIRADO), JT, "all", { actor: JT_ACTOR }))
      .rejects.toThrow(/Prevención/)
  })

  it("Prevención registra cualquier actividad de su faena", async () => {
    await markPdtpExecution(cell(ACT_JT), PREV, "all", { actor: PREV_ACTOR })
    expect((await executionOf(ACT_JT))?.executedByUserId).toBe(PREV)
  })

  it("con asignación nominal, otro responsable del mismo cargo no registra y la persona asignada sí", async () => {
    await assign(ACT_JT, JT)
    await expect(markPdtpExecution(cell(ACT_JT), JT_2, "all", { actor: JT_2_ACTOR }))
      .rejects.toThrow(/asignada a otra persona/i)
    await markPdtpExecution(cell(ACT_JT), JT, "all", { actor: JT_ACTOR })
    expect((await executionOf(ACT_JT))?.executedByUserId).toBe(JT)
  })
})

describe("PREV-I03 — reporte de obligación (reportPdtpObligation)", () => {
  async function openObligation() {
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ scheduleMode: "on_demand", evidenceRequirement: "Acta", dueDays: 5 })
      .where(eq(schema.pdtpActivities.id, ACT_JT))
    const created = await createPdtpObligation({
      activityId: ACT_JT, worksiteId: WS, origin: "manual", plannedQuantity: 1,
      manualReason: "Caso abierto para la prueba de autoridad", clientRequestId: `req-${Math.random()}`,
      sourceMetadata: {}, userId: PREV, scope: "all",
    })
    return created.obligation.id
  }

  it("un rol global no operacional no reporta la obligación de otro cargo", async () => {
    const obligationId = await openObligation()
    await expect(reportPdtpObligation({
      obligationId, executedQuantity: 1, evidenceUrl: evidenceFile("obl-legal.pdf"),
      userId: LEGAL, scope: "all", actor: LEGAL_ACTOR,
    })).rejects.toThrow(/Solo su responsable/)
  })

  it("el responsable por cargo la reporta", async () => {
    const obligationId = await openObligation()
    const result = await reportPdtpObligation({
      obligationId, executedQuantity: 1, evidenceUrl: evidenceFile("obl-jt.pdf"),
      userId: JT, scope: "all", actor: JT_ACTOR,
    })
    expect(result.execution.executedByUserId).toBe(JT)
  })
})

describe("PREV-I03 — envío de una ocurrencia programada", () => {
  async function instance(id: string) {
    const now = new Date().toISOString()
    const scheduledFor = todayInChile()
    await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
      id, programId: PROGRAM_ID, activityId: ACT_JT, worksiteId: WS, scheduledFor,
      isoWeekYear: YEAR, isoWeek: 1, plannedQuantity: 1, status: "pending",
      idempotencyKey: `pdtp-scheduled:${id}`, sourceMetadataJson: {}, createdAt: now, updatedAt: now,
    })
  }

  it("quien no responde por la actividad no envía la ocurrencia", async () => {
    await instance("inst-authority-legal")
    await expect(recordPdtpScheduledInstanceOutcome({
      instanceId: "inst-authority-legal", action: "submit", userId: LEGAL, scope: "all", actor: LEGAL_ACTOR,
    })).rejects.toThrow(/Solo su responsable/)
    const [row] = await inMemoryDb.select().from(schema.pdtpScheduledInstances)
      .where(eq(schema.pdtpScheduledInstances.id, "inst-authority-legal"))
    expect(row?.status).toBe("pending")
  })

  it("el responsable por cargo la envía", async () => {
    await instance("inst-authority-jt")
    const updated = await recordPdtpScheduledInstanceOutcome({
      instanceId: "inst-authority-jt", action: "submit", userId: JT, scope: "all", actor: JT_ACTOR,
    })
    expect(updated.status).toBe("submitted")
  })
})

describe("listPdtpRegistrableActivityIds — lo que la UI ofrece registrar", () => {
  it("devuelve sólo lo propio para el responsable y todo para Prevención", async () => {
    await assign(ACT_CONDUCTORES, JT_2)
    const ids = [ACT_JT, ACT_CONDUCTORES, ACT_RETIRADO]
    expect([...await listPdtpRegistrableActivityIds({ activityIds: ids, worksiteId: WS, actor: JT_ACTOR })]).toEqual([ACT_JT])
    expect([...await listPdtpRegistrableActivityIds({ activityIds: ids, worksiteId: WS, actor: JT_2_ACTOR })].sort()).toEqual([ACT_CONDUCTORES, ACT_JT].sort())
    expect([...await listPdtpRegistrableActivityIds({ activityIds: ids, worksiteId: WS, actor: LEGAL_ACTOR })]).toEqual([])
    expect([...await listPdtpRegistrableActivityIds({ activityIds: ids, worksiteId: WS, actor: PREV_ACTOR })].sort()).toEqual([...ids].sort())
  })
})
