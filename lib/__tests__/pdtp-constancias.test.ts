/**
 * lib/__tests__/pdtp-constancias.test.ts
 *
 * Submódulo Constancias (G17): `listPdtpConstanciaActivities` replica la
 * regla "primer mes impago" de la cola operacional (`impago.mes` en
 * operational-work-queue.ts) para que el badge de /pendientes y esta lista
 * cuenten exactamente lo mismo, y `assertPdtpActivityMechanism` es la
 * compuerta que evita que `prevention:constancias:execute` sirva para marcar
 * cualquier actividad de la planilla.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

// Task 9: `markPdtpExecution` ahora verifica que `evidenceUrl` resuelva a un
// archivo físico (H-B7) antes de contarlo como "evidencia real" — mismo
// patrón que `pdtp-evidence-gc.test.ts`: STORAGE_PATH apunta a un tmpdir
// propio de este archivo, restaurado en `afterAll`.
const previousStoragePath = process.env.STORAGE_PATH
const tmpEvidenceRoot = join(tmpdir(), `pdtp-constancias-evidence-${Date.now()}`)
process.env.STORAGE_PATH = tmpEvidenceRoot
mkdirSync(join(tmpEvidenceRoot, "pdtp-evidence"), { recursive: true })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = previousStoragePath
})

const { listPdtpConstanciaActivities, assertPdtpActivityMechanism } = await import("@/lib/services/pdtp/constancias")
const { markPdtpExecution } = await import("@/lib/services/pdtp/executions")

const { year: PROGRAM_YEAR, month: CURRENT_MONTH } = chileDateParts()
/** Enero no tiene mes anterior dentro del año: el caso "vencida" se apoya en
 * el mes en curso y las pruebas que lo necesitan se saltan sin él. */
const PREVIOUS_MONTH = CURRENT_MONTH > 1 ? CURRENT_MONTH - 1 : null
const PROGRAM_ID = "pdtp-constancias-v1"
const WS_A = "ws-constancias-a"
const WS_B = "ws-constancias-b"
const ACT_N = 61
const ACT_ID = `${PROGRAM_ID}-a-${String(ACT_N).padStart(3, "0")}`

async function seedProgram(status: "draft" | "active" = "active", activatedAt: string | null = null) {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} constancias`,
    status, appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedAt,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}

async function seedActivity(overrides: Partial<typeof schema.pdtpActivities.$inferInsert> = {}) {
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID, programId: PROGRAM_ID, n: ACT_N,
    activity: "Controlar los certificados que acrediten la idoneidad del producto",
    program: "Prevención PDTP",
    responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista de riesgos en faena",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "constancia", evidenceRequirement: "Certificado vigente",
    sourceSheetRow: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  })
}

async function seedSchedule(worksiteId: string, month: number, plannedQuantity = 1) {
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `${ACT_ID}-s-${PROGRAM_YEAR}-${String(month).padStart(2, "0")}-1`,
    activityId: ACT_ID, year: PROGRAM_YEAR, month, week: 1, plannedQuantity, sourceColumn: "manual",
  })
  // La planificación no es por faena en el schema (es una sola fila por
  // actividad/mes/semana); lo que cambia por faena es si hay ejecución. Un
  // segundo `insert` con el mismo `id` para otra faena violaría la PK, así
  // que sólo se siembra una vez y el test usa `worksiteId` sólo para elegir
  // dónde marcar la ejecución.
  void worksiteId
}

async function markExecuted(worksiteId: string, month: number, status: "submitted" | "approved" | "draft" = "approved") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: `${ACT_ID}-e-${worksiteId}-${PROGRAM_YEAR}-${String(month).padStart(2, "0")}-1`,
    activityId: ACT_ID, worksiteId, year: PROGRAM_YEAR, month, week: 1,
    executedQuantity: 1, status, origin: "manual", createdAt: now, updatedAt: now,
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-constancias-1", name: "U1", email: "u1-constancias@test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FB", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
    slug: "prf", displayName: "Prevencionista de riesgos en faena", roleName: "prevencionista_faena", kind: "rbac_role",
  })
})

describe("listPdtpConstanciaActivities", () => {
  it("sin programa activo, devuelve null (no hay dónde marcar)", async () => {
    await seedProgram("draft")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
    expect(await listPdtpConstanciaActivities("all")).toBeNull()
  })

  it("una actividad planificada este mes sin marcar es 'pending', con el mes en curso como deuda", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)

    // Acotado a WS_A: en scope "all" la misma fila de schedule (no es por
    // faena) también generaría deuda para WS_B, que no es lo que este caso
    // prueba — eso lo cubre el test de alcance más abajo.
    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1)
    expect(view?.debts[0]).toMatchObject({
      activityId: ACT_ID, n: ACT_N, worksiteId: WS_A, dueMonth: CURRENT_MONTH, dueWeek: 1, status: "pending", overdueMonths: 0,
    })
  })

  it("dueWeek es la menor semana planificada del mes adeudado, no una por defecto", async () => {
    // `seedSchedule` siempre usa week 1; acá se siembra a mano una celda de
    // constancia con semanas 3 y 2 (en ese orden de inserción, a propósito)
    // para que el test no pase por casualidad si la implementación tomara la
    // primera fila en vez de la menor.
    await seedProgram("active")
    await seedActivity()
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
      { id: `${ACT_ID}-s-${PROGRAM_YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}-3`, activityId: ACT_ID, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 3, plannedQuantity: 1, sourceColumn: "manual" },
      { id: `${ACT_ID}-s-${PROGRAM_YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}-2`, activityId: ACT_ID, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 2, plannedQuantity: 1, sourceColumn: "manual" },
    ])

    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1)
    expect(view?.debts[0]).toMatchObject({ dueMonth: CURRENT_MONTH, dueWeek: 2 })
  })

  it("un mes anterior sin marcar es 'overdue' y queda como el mes que corresponde marcar, no el actual", async () => {
    if (PREVIOUS_MONTH === null) return // enero: no hay mes anterior en el año
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, PREVIOUS_MONTH)
    await seedSchedule(WS_A, CURRENT_MONTH)

    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1) // una fila, no una por mes vencido
    expect(view?.debts[0]).toMatchObject({ dueMonth: PREVIOUS_MONTH, dueWeek: 1, status: "overdue", overdueMonths: 1 })
  })

  it("marcar con status 'submitted' o 'approved' salda la deuda; 'draft' no", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
    await markExecuted(WS_A, CURRENT_MONTH, "submitted")
    expect((await listPdtpConstanciaActivities([WS_A]))?.debts).toHaveLength(0)

    await inMemoryDb.delete(schema.pdtpExecutions)
    await markExecuted(WS_A, CURRENT_MONTH, "draft")
    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1) // draft no cuenta como marcado
  })

  it("respeta el alcance de faenas del usuario: sin acceso a WS_B, su deuda no aparece", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)

    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts.map((debt) => debt.worksiteId)).toEqual([WS_A])
  })

  it("una faena excluida de la actividad (R4) no aporta deuda", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: `${ACT_ID}-excl-${WS_A}`, activityId: ACT_ID, worksiteId: WS_A,
      reason: "Faena sin el requisito.", createdByUserId: "user-constancias-1", createdAt: new Date().toISOString(),
    })
    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(0)
  })

  it("una actividad de otro mecanismo (enganche) no entra a la lista", async () => {
    await seedProgram("active")
    await seedActivity({ mechanism: "enganche" })
    await seedSchedule(WS_A, CURRENT_MONTH)
    const view = await listPdtpConstanciaActivities("all")
    expect(view?.debts).toHaveLength(0)
  })

  it("sin actividad planificada este mes ni antes, no hay deuda (no confundir con 'al día')", async () => {
    await seedProgram("active")
    await seedActivity()
    const view = await listPdtpConstanciaActivities("all")
    expect(view?.debts).toHaveLength(0)
    expect(view?.programId).toBe(PROGRAM_ID)
  })

  it("no ofrece deuda de un período anterior a la activación del programa", async () => {
    if (PREVIOUS_MONTH === null) return // enero: no hay mes anterior en el año
    // El programa se activó este mes: la celda del mes anterior ya no es
    // exigible — `markPdtpExecution` la rechazaría igual.
    //
    // La activación se fija al día 1 y no a `now`: `seedSchedule` siembra
    // siempre `week: 1`, y la regla conserva entera la semana de activación
    // descartando las anteriores. Activar "hoy" hacía que del día 8 en
    // adelante la propia celda del mes en curso quedara fuera, así que el
    // caso sólo pasaba la primera semana de cada mes. Mediodía UTC para que
    // la hora de Chile no corra la fecha al mes anterior.
    await seedProgram("active", new Date(Date.UTC(PROGRAM_YEAR, CURRENT_MONTH - 1, 1, 12)).toISOString())
    await seedActivity()
    await seedSchedule(WS_A, PREVIOUS_MONTH)
    await seedSchedule(WS_A, CURRENT_MONTH)

    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1)
    expect(view?.debts[0]).toMatchObject({ dueMonth: CURRENT_MONTH, status: "pending", overdueMonths: 0 })
  })
})

describe("markPdtpExecution — evidencia mínima declarada", () => {
  // Task 9: las actividades de mecanismo 'constancia' declaran su evidencia
  // mínima en evidenceRequirement. ACT_ID declara "Certificado vigente" (ver
  // seedActivity). Una constancia sin nada de evidencia se rechaza; una con
  // sólo observación de texto TAMBIÉN se rechaza ahora (M2.1: una
  // observación no acredita nada por sí sola cuando la actividad exige
  // evidencia) — sólo un archivo real (evidenceUrl/evidencePhotos que
  // resuelvan a un archivo físico) satisface el requisito.
  beforeEach(async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
  })

  // Ronda de corrección (2026-09-23, revisión final): con el gate genérico
  // restaurado, una constancia sin NINGUNA evidencia dispara dos condiciones a
  // la vez (genérica y específica de Task 9) — el mensaje que debe ganar es el
  // más específico ("adjunta un archivo"), no el genérico, porque le dice al
  // usuario exactamente qué falta. Ver el comentario junto a los dos gates en
  // executions.ts.
  it("rechaza una constancia sin evidencia cuando la actividad declara una (gana el mensaje específico, no el genérico)", async () => {
    await expect(markPdtpExecution({
      activityId: ACT_ID, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, evidenceText: "", evidenceUrl: "", evidencePhotos: [],
    }, "user-constancias-1", "all")).rejects.toThrow(/no basta/i)
  })

  it("rechaza la misma constancia con sólo una observación de texto — ya no basta (M2.1)", async () => {
    await expect(markPdtpExecution({
      activityId: ACT_ID, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, evidenceText: "Acta firmada por los 12 asistentes", evidenceUrl: "", evidencePhotos: [],
    }, "user-constancias-1", "all")).rejects.toThrow(/no basta/i)
  })

  it("acepta la misma constancia con un archivo real de evidencia adjunto", async () => {
    writeFileSync(join(tmpEvidenceRoot, "pdtp-evidence", "certificado-vigente.pdf"), "%PDF-1.4 test")
    await expect(markPdtpExecution({
      activityId: ACT_ID, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, evidenceText: "Acta firmada por los 12 asistentes",
      evidenceUrl: "storage/pdtp-evidence/certificado-vigente.pdf", evidencePhotos: [],
    }, "user-constancias-1", "all")).resolves.toBeDefined()
  })

  it("un reenvío que sólo corrige el texto conserva el archivo ya adjuntado (append-only)", async () => {
    writeFileSync(join(tmpEvidenceRoot, "pdtp-evidence", "certificado-reenvio.pdf"), "%PDF-1.4 test")
    await markPdtpExecution({
      activityId: ACT_ID, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, evidenceText: "Primer envío con archivo",
      evidenceUrl: "storage/pdtp-evidence/certificado-reenvio.pdf", evidencePhotos: [],
    }, "user-constancias-1", "all")

    const second = await markPdtpExecution({
      activityId: ACT_ID, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
      executedQuantity: 1, evidenceText: "Segundo envío, sólo corrige el texto", evidenceUrl: "", evidencePhotos: [],
    }, "user-constancias-1", "all")
    expect(second.evidenceUrl).toBe("storage/pdtp-evidence/certificado-reenvio.pdf")
  })

  // Ronda de corrección (2026-09-23): el gate de evidencia real de M2.1 se
  // acotó a `mechanism === 'constancia'` — ver el comentario junto al gate en
  // executions.ts. Sin acotar rompía, sin ningún test que lo cubriera, el
  // fallback `solo_manual` documentado en responsible-execution.ts:17-26:
  // cuando ninguno de los responsables declarados de una actividad
  // `enganche`/`compuesta` tiene el permiso del módulo que la acredita
  // automáticamente, el sistema permite registrarla a mano en la planilla del
  // PDTP con evidencia autodeclarada (sólo texto) en vez del registro real del
  // módulo de origen. 19 actividades reales del catálogo 2026 dependen de este
  // fallback, incluida toda la cadena RE-20 (N°66 a 78) — ver
  // `scripts/apply-pdtp-2026-demand-slas.ts:77-175`.
  it.each(["enganche", "compuesta"] as const)(
    "acepta evidencia de sólo texto en una actividad '%s' con evidenceRequirement (fallback solo_manual preservado)",
    async (mechanism) => {
      const otherActId = `${PROGRAM_ID}-a-099-${mechanism}`
      await inMemoryDb.insert(schema.pdtpActivities).values({
        id: otherActId, programId: PROGRAM_ID, n: mechanism === "enganche" ? 98 : 99,
        activity: `Actividad ${mechanism} con evidencia mínima declarada`,
        program: "Prevención PDTP",
        responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista de riesgos en faena",
        scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
        mechanism, evidenceRequirement: "Registro verificable en el módulo de origen",
        sourceSheetRow: mechanism === "enganche" ? 2 : 3,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
      await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
        id: `${otherActId}-s-${PROGRAM_YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}-1`,
        activityId: otherActId, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1, plannedQuantity: 1, sourceColumn: "manual",
      })

      const execution = await markPdtpExecution({
        activityId: otherActId, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
        executedQuantity: 1,
        evidenceText: "Registro autodeclarado por el responsable, sin archivo adjunto",
        evidenceUrl: "", evidencePhotos: [],
      }, "user-constancias-1", "all")
      expect(execution.status).toBe("submitted")
      expect(execution.evidenceText).toBe("Registro autodeclarado por el responsable, sin archivo adjunto")
      expect(execution.evidenceUrl).toBeNull()
    },
  )

  // Hallazgo 1 de la revisión final (2026-09-23): comparado contra `main`
  // (commit 64bbdeba), acotar el gate de evidencia real a `constancia` (ronda
  // de arriba) se llevó por delante, sin querer, el gate GENÉRICO que ya
  // existía en `main` — cualquier actividad con `evidenceRequirement` exigía
  // al menos texto/URL/foto, sin importar el mecanismo. El fallback
  // `solo_manual` que el test de arriba protege siempre exigió ESO como
  // mínimo (texto autodeclarado); nunca "nada en absoluto". Esta prueba
  // reproduce exactamente la regresión: antes del segundo gate restaurado,
  // esto pasaba silenciosamente para `enganche`/`compuesta`.
  it.each(["enganche", "compuesta"] as const)(
    "rechaza una ejecución completamente vacía (sin texto, sin URL, sin foto) en una actividad '%s' con evidenceRequirement — regresión real de main",
    async (mechanism) => {
      const otherActId = `${PROGRAM_ID}-a-096-${mechanism}`
      await inMemoryDb.insert(schema.pdtpActivities).values({
        id: otherActId, programId: PROGRAM_ID, n: mechanism === "enganche" ? 96 : 97,
        activity: `Actividad ${mechanism} con evidencia mínima declarada`,
        program: "Prevención PDTP",
        responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista de riesgos en faena",
        scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
        mechanism, evidenceRequirement: "Registro verificable en el módulo de origen",
        sourceSheetRow: mechanism === "enganche" ? 6 : 7,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
      await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
        id: `${otherActId}-s-${PROGRAM_YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}-1`,
        activityId: otherActId, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1, plannedQuantity: 1, sourceColumn: "manual",
      })

      await expect(markPdtpExecution({
        activityId: otherActId, worksiteId: WS_A, year: PROGRAM_YEAR, month: CURRENT_MONTH, week: 1,
        executedQuantity: 1, evidenceText: "", evidenceUrl: "", evidencePhotos: [],
      }, "user-constancias-1", "all")).rejects.toThrow(/^Esta actividad exige evidencia: Registro verificable en el módulo de origen$/)
    },
  )
})

describe("assertPdtpActivityMechanism", () => {
  it("resuelve cuando el mecanismo coincide", async () => {
    await seedProgram("active")
    await seedActivity({ mechanism: "constancia" })
    await expect(assertPdtpActivityMechanism(ACT_ID, "constancia")).resolves.toBeUndefined()
  })

  it("lanza cuando el mecanismo no coincide — la compuerta de alcance de prevention:constancias:execute", async () => {
    await seedProgram("active")
    await seedActivity({ mechanism: "enganche" })
    await expect(assertPdtpActivityMechanism(ACT_ID, "constancia")).rejects.toThrow(/no se puede registrar desde Constancias/)
  })

  it("lanza cuando la actividad no existe", async () => {
    await expect(assertPdtpActivityMechanism("no-existe", "constancia")).rejects.toThrow()
  })
})
