/**
 * lib/__tests__/prevention-alcotest.test.ts
 *
 * Alcotest (G14, DS 44 / DO-48): N°30 y N°31 comparten texto de catálogo y
 * sólo difieren en el responsable — el conector elige el número por el rol de
 * quien registra, no por un campo propio de la fila. N°32 es el envío mensual
 * del lote, una entidad propia, no un control más.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const {
  resolveAlcotestActivityNumber,
  recordAlcoholTest,
  recordAlcoholTestDispatch,
  listAlcoholTests,
  listAlcoholTestDispatches,
  listAlcotestWorkers,
  listAlcotestEquipment,
} = await import("@/lib/services/prevention-alcotest")

const { year: PROGRAM_YEAR } = chileDateParts()
const PROGRAM_ID = "pdtp-alcotest-v1"
const WS_ID = "ws-alcotest-1"
const WS_OTHER = "ws-alcotest-2"
const USER_PRF = "user-alcotest-prf"
const USER_SUP = "user-alcotest-sup"
const WORKER_ID = "worker-alcotest-1"
const WORKER_OTHER = "worker-alcotest-2"
const EQUIPMENT_ID = "eq-alcotest-1"
const EQUIPMENT_OTHER = "eq-alcotest-2"
const EQUIPMENT_MONOGAS = "eq-monogas-1"

/** Sujeto por defecto para los casos que no prueban la identificación. */
const SUBJECT = { testedWorkerId: WORKER_ID }
const N30_ID = `${PROGRAM_ID}-a-030`
const N31_ID = `${PROGRAM_ID}-a-031`
const N32_ID = `${PROGRAM_ID}-a-032`

async function seedProgramAndActivities() {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} alcotest`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values([
    {
      id: N30_ID, programId: PROGRAM_ID, n: 30, activity: "Realizar alcotest", program: "Prevención PDTP",
      responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed", mechanism: "enganche",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    },
    {
      id: N31_ID, programId: PROGRAM_ID, n: 31, activity: "Realizar alcotest", program: "Prevención PDTP",
      responsibleSlugs: ["sup", "jt"], responsibleDisplay: "Supervisor / Jefe de terreno", scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed", mechanism: "enganche",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    },
    {
      id: N32_ID, programId: PROGRAM_ID, n: 32, activity: "Envio registros alcotest, según DO-48", program: "Prevención PDTP",
      responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed", mechanism: "enganche",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    },
  ])
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.alcoholTestDispatches)
  await inMemoryDb.delete(schema.alcoholTests)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.serviceEquipment)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: USER_PRF, name: "Prevencionista", email: "prf-alcotest@example.test", hashedPassword: "x" },
    { id: USER_SUP, name: "Supervisor", email: "sup-alcotest@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_ID, name: "Faena Alcotest", code: "FALC", isActive: true },
    { id: WS_OTHER, name: "Faena Vecina", code: "FALC2", isActive: true },
  ])
  await inMemoryDb.insert(schema.workers).values([
    { id: WORKER_ID, firstName: "Ana", lastName: "Pérez", worksiteId: WS_ID, isActive: true },
    { id: WORKER_OTHER, firstName: "Bruno", lastName: "Soto", worksiteId: WS_OTHER, isActive: true },
  ])
  await inMemoryDb.insert(schema.serviceEquipment).values([
    { id: EQUIPMENT_ID, code: "ALC-001", name: "Alcotómetro faena", kind: "alcotest", worksiteId: WS_ID, isActive: true },
    { id: EQUIPMENT_OTHER, code: "ALC-002", name: "Alcotómetro vecino", kind: "alcotest", worksiteId: WS_OTHER, isActive: true },
    { id: EQUIPMENT_MONOGAS, code: "MG-014", name: "Detector monogás", kind: "monogas", worksiteId: WS_ID, isActive: true },
  ])
})

describe("resolveAlcotestActivityNumber", () => {
  it("PRF y prevencionista global cierran la N°30", () => {
    expect(resolveAlcotestActivityNumber(["prevencionista_faena"])).toBe(30)
    expect(resolveAlcotestActivityNumber(["prevencionista"])).toBe(30)
  })
  it("supervisor y jefe de terreno cierran la N°31", () => {
    expect(resolveAlcotestActivityNumber(["supervisor_terreno"])).toBe(31)
    expect(resolveAlcotestActivityNumber(["jefe_terreno"])).toBe(31)
  })
  it("prefiere PRF si el usuario tiene ambos roles", () => {
    expect(resolveAlcotestActivityNumber(["supervisor_terreno", "prevencionista_faena"])).toBe(30)
  })
  it("un rol sin mapeo no cierra nada", () => {
    expect(resolveAlcotestActivityNumber(["administrador"])).toBeNull()
    expect(resolveAlcotestActivityNumber([])).toBeNull()
  })
})

describe("recordAlcoholTest", () => {
  it("PRF registra y acredita la N°30, no la N°31", async () => {
    await seedProgramAndActivities()
    const created = await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z", result: "negativo" },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )
    expect(created.result).toBe("negativo")

    const execN30 = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, N30_ID))
    const execN31 = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, N31_ID))
    expect(execN30).toHaveLength(1)
    expect(execN31).toHaveLength(0)
    // No autoaprobado (accreditation.ts:169-171): sólo "inspeccion" nace aprobada.
    expect(execN30[0]?.status).toBe("submitted")
  })

  it("supervisor y jefe de terreno acreditan la N°31, no la N°30", async () => {
    await seedProgramAndActivities()
    await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "noche", performedAt: "2026-03-06T02:00:00.000Z" },
      USER_SUP, ["supervisor_terreno"], [WS_ID],
    )
    const execN31 = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, N31_ID))
    expect(execN31).toHaveLength(1)
  })

  it("un rol sin mapeo no registra ni acredita nada", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z" },
      "user-x", ["administrador"], [WS_ID],
    )).rejects.toThrow(/no está habilitado/)
    expect(await inMemoryDb.select().from(schema.alcoholTests)).toHaveLength(0)
  })

  it("fuera de alcance de faenas, no registra (assertWorksiteAccess)", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z" },
      USER_PRF, ["prevencionista_faena"], [],
    )).rejects.toThrow(/no encontrada o sin acceso/)
  })
})

describe("recordAlcoholTest — a quién se le tomó el control", () => {
  const base = { worksiteId: WS_ID, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z" }

  it("exige identificar a la persona: sin trabajador ni nombre, no registra", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest(base, USER_PRF, ["prevencionista_faena"], [WS_ID]))
      .rejects.toThrow(/a quién se le tomó el control/)
    expect(await inMemoryDb.select().from(schema.alcoholTests)).toHaveLength(0)
  })

  it("no admite trabajador y nombre de tercero a la vez", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest(
      { ...base, testedWorkerId: WORKER_ID, testedPersonName: "Juan Tercero" },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )).rejects.toThrow(/no ambos/)
  })

  it("acepta un tercero por nombre: el chofer de un proveedor no está en workers", async () => {
    await seedProgramAndActivities()
    const created = await recordAlcoholTest(
      { ...base, testedPersonName: "Juan Tercero" },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )
    expect(created.testedWorkerId).toBeNull()
    expect(created.testedPersonName).toBe("Juan Tercero")
  })

  it("rechaza a una persona de otra faena", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest(
      { ...base, testedWorkerId: WORKER_OTHER },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )).rejects.toThrow(/pertenece a otra faena/)
  })

  it("rechaza a una persona inactiva", async () => {
    await seedProgramAndActivities()
    await inMemoryDb.update(schema.workers).set({ isActive: false }).where(eq(schema.workers.id, WORKER_ID))
    await expect(recordAlcoholTest(
      { ...base, testedWorkerId: WORKER_ID },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )).rejects.toThrow(/no existe o está inactiva/)
  })
})

describe("recordAlcoholTest — con qué equipo", () => {
  const base = { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z" }

  it("enlaza el alcotómetro, cuya calibración se controla en equipos de servicio", async () => {
    await seedProgramAndActivities()
    const created = await recordAlcoholTest({ ...base, equipmentId: EQUIPMENT_ID }, USER_PRF, ["prevencionista_faena"], [WS_ID])
    expect(created.equipmentId).toBe(EQUIPMENT_ID)
  })

  it("sigue admitiendo un control sin equipo: no todo alcotómetro está dado de alta", async () => {
    await seedProgramAndActivities()
    const created = await recordAlcoholTest(base, USER_PRF, ["prevencionista_faena"], [WS_ID])
    expect(created.equipmentId).toBeNull()
  })

  it("rechaza un equipo que no es alcotómetro", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest({ ...base, equipmentId: EQUIPMENT_MONOGAS }, USER_PRF, ["prevencionista_faena"], [WS_ID]))
      .rejects.toThrow(/no es un alcotómetro/)
  })

  it("rechaza un alcotómetro de otra faena", async () => {
    await seedProgramAndActivities()
    await expect(recordAlcoholTest({ ...base, equipmentId: EQUIPMENT_OTHER }, USER_PRF, ["prevencionista_faena"], [WS_ID]))
      .rejects.toThrow(/pertenece a otra faena/)
  })

  it("rechaza un alcotómetro dado de baja", async () => {
    await seedProgramAndActivities()
    await inMemoryDb.update(schema.serviceEquipment).set({ isActive: false }).where(eq(schema.serviceEquipment.id, EQUIPMENT_ID))
    await expect(recordAlcoholTest({ ...base, equipmentId: EQUIPMENT_ID }, USER_PRF, ["prevencionista_faena"], [WS_ID]))
      .rejects.toThrow(/no existe o está inactivo/)
  })
})

describe("listAlcotestWorkers / listAlcotestEquipment", () => {
  it("acotan por faena y por alcance, y el equipo sólo trae alcotómetros activos", async () => {
    expect((await listAlcotestWorkers([WS_ID])).map((worker) => worker.id)).toEqual([WORKER_ID])
    expect(await listAlcotestWorkers([])).toHaveLength(0)
    expect((await listAlcotestWorkers("all")).map((worker) => worker.id).sort()).toEqual([WORKER_ID, WORKER_OTHER].sort())

    // El monogás de la misma faena no entra: `kind` distinto.
    expect((await listAlcotestEquipment([WS_ID])).map((item) => item.id)).toEqual([EQUIPMENT_ID])
    expect((await listAlcotestEquipment("all")).map((item) => item.id).sort()).toEqual([EQUIPMENT_ID, EQUIPMENT_OTHER].sort())
    expect(await listAlcotestEquipment([])).toHaveLength(0)
  })
})

describe("recordAlcoholTestDispatch", () => {
  it("cuenta los controles del período y acredita la N°32 una sola vez", async () => {
    await seedProgramAndActivities()
    await recordAlcoholTest({ worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z" }, USER_PRF, ["prevencionista_faena"], [WS_ID])
    await recordAlcoholTest({ worksiteId: WS_ID, ...SUBJECT, shift: "noche", performedAt: "2026-03-20T02:00:00.000Z" }, USER_SUP, ["supervisor_terreno"], [WS_ID])
    // Fuera del período: no debe contarse.
    await recordAlcoholTest({ worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-04-01T14:00:00.000Z" }, USER_PRF, ["prevencionista_faena"], [WS_ID])

    const dispatch = await recordAlcoholTestDispatch(
      { worksiteId: WS_ID, year: 2026, month: 3, recipient: "Mutualidad" },
      USER_PRF, [WS_ID],
    )
    expect(dispatch.testCount).toBe(2)

    const execN32 = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, N32_ID))
    expect(execN32).toHaveLength(1)

    await expect(recordAlcoholTestDispatch(
      { worksiteId: WS_ID, year: 2026, month: 3, recipient: "Mutualidad" },
      USER_PRF, [WS_ID],
    )).rejects.toThrow(/Ya se registró el envío/)
  })
})

describe("listAlcoholTests / listAlcoholTestDispatches", () => {
  it("respetan el alcance de faenas del usuario", async () => {
    await seedProgramAndActivities()
    await recordAlcoholTest({ worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z" }, USER_PRF, ["prevencionista_faena"], [WS_ID])
    expect(await listAlcoholTests([WS_ID])).toHaveLength(1)
    expect(await listAlcoholTests([])).toHaveLength(0)
    expect(await listAlcoholTests("all")).toHaveLength(1)

    await recordAlcoholTestDispatch({ worksiteId: WS_ID, year: 2026, month: 3, recipient: "Mutualidad" }, USER_PRF, [WS_ID])
    expect(await listAlcoholTestDispatches([WS_ID])).toHaveLength(1)
    expect(await listAlcoholTestDispatches([])).toHaveLength(0)
  })
})
