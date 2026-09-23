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
import { readModuleHistory } from "@/lib/testing/audit-history"

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

const {
  ensureAlcotestSlotsForWorksiteTx,
} = await import("@/lib/services/prevention-program-slots")

const {
  listAlcotestSlotsForWorksite,
  recordAlcotestSlotStatus,
  attachAlcotestSlotEvidenceTx,
  AlcotestSlotError,
} = await import("@/lib/services/prevention-alcotest-slots")

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
/** Quien declara casillas en estos casos: un PRF de la faena (N°30). */
const PRF_ACTOR = { userId: USER_PRF, scope: [WS_ID], roles: ["prevencionista_faena"] }
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
  /* Las casillas van primero: apuntan al control y al envío con `restrict`, así
   * que borrar el hecho antes deja la casilla huérfana y Postgres lo rechaza. */
  /* El `audit_log` va primero: su FK a `users` impide borrar un usuario que
   * actuó, y ahora las casillas dejan traza ahí. */
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionAlcotestSlotEvidence)
  await inMemoryDb.delete(schema.preventionAlcotestSlots)
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
    // M0.4: alcotest sí puede auto-aprobarse, pero sólo con evidencia real
    // (`AUTO_APPROVE_SOURCE_TYPES_WITH_REAL_EVIDENCE` en accreditation.ts).
    // Sin `slotId` no hay casilla que aporte una ruta de storage, así que el
    // conector cae al rótulo sintético "Control de alcotest <id>" y el motor
    // lo deja `submitted` para revisión manual — ver el describe "M0.4" más
    // abajo para el caso con evidencia real.
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

/* ── Casillas del programa ────────────────────────────────────────────────── */

const SLOT_YEAR = 2026

/** Siembra las casillas y devuelve la de control de marzo. */
async function seedSlots(worksiteId = WS_ID) {
  await ensureAlcotestSlotsForWorksiteTx(inMemoryDb as never, worksiteId, SLOT_YEAR)
  const slots = await listAlcotestSlotsForWorksite([worksiteId], worksiteId, SLOT_YEAR, inMemoryDb as never)
  return slots
}

async function evidenciaEn(slotId: string) {
  await inMemoryDb.insert(schema.preventionAlcotestSlotEvidence).values({
    id: `alcev-${slotId}`,
    slotId,
    fileName: "planilla-marzo.pdf",
    storagePath: `alcotest/${slotId}/planilla-marzo.pdf`,
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    sha256: "a".repeat(64),
    state: "active",
    uploadedByUserId: USER_PRF,
  })
}

describe("pre-generación de las casillas de alcotest", () => {
  it("siembra 12 controles y 11 envíos, y es idempotente", async () => {
    const creadas = await ensureAlcotestSlotsForWorksiteTx(inMemoryDb as never, WS_ID, SLOT_YEAR)
    expect(creadas).toBe(23)
    // Reejecutar no duplica ni pisa: los ids son determinísticos.
    expect(await ensureAlcotestSlotsForWorksiteTx(inMemoryDb as never, WS_ID, SLOT_YEAR)).toBe(0)

    const slots = await listAlcotestSlotsForWorksite([WS_ID], WS_ID, SLOT_YEAR, inMemoryDb as never)
    expect(slots.filter((s) => s.kind === "control")).toHaveLength(12)
    expect(slots.filter((s) => s.kind === "envio")).toHaveLength(11)
    expect(slots.every((s) => s.status === "pending")).toBe(true)
  })

  it("control y envío del mismo mes no colisionan: el tipo es parte del unique", async () => {
    const slots = await seedSlots()
    const febrero = slots.filter((s) => s.scheduledMonth === 2)
    expect(febrero.map((s) => s.kind).sort()).toEqual(["control", "envio"])
  })
})

describe("recordAlcotestSlotStatus", () => {
  it("declara la casilla no aplicable sólo con un motivo escrito", async () => {
    const [slot] = await seedSlots()
    await expect(recordAlcotestSlotStatus(
      { slotId: slot!.id, expectedVersion: 1, status: "not_applicable" },
      PRF_ACTOR,
    )).rejects.toThrow()
    await expect(recordAlcotestSlotStatus(
      { slotId: slot!.id, expectedVersion: 1, status: "not_applicable", notApplicableReason: "corto" },
      PRF_ACTOR,
    )).rejects.toThrow()

    const updated = await recordAlcotestSlotStatus(
      {
        slotId: slot!.id,
        expectedVersion: 1,
        status: "not_applicable",
        notApplicableReason: "La faena no tiene conducción de vehículos ni turnos nocturnos.",
      },
      PRF_ACTOR,
    )
    expect(updated.status).toBe("not_applicable")
    expect(updated.notApplicableByUserId).toBe(USER_PRF)
  })

  it("corregir a no hecha limpia el motivo, que si no queda colgado", async () => {
    const [slot] = await seedSlots()
    const na = await recordAlcotestSlotStatus(
      {
        slotId: slot!.id,
        expectedVersion: 1,
        status: "not_applicable",
        notApplicableReason: "La faena no tiene conducción de vehículos ni turnos nocturnos.",
      },
      PRF_ACTOR,
    )
    const corregida = await recordAlcotestSlotStatus(
      { slotId: slot!.id, expectedVersion: na.version, status: "not_completed" },
      PRF_ACTOR,
    )
    expect(corregida.status).toBe("not_completed")
    expect(corregida.notApplicableReason).toBeNull()
    expect(corregida.notApplicableAt).toBeNull()
    expect(corregida.notApplicableByUserId).toBeNull()
  })

  it("no deja apagar el cumplimiento sin tocar el hecho", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const marzo = slots.find((s) => s.kind === "control" && s.scheduledMonth === 3)!
    await evidenciaEn(marzo.id)
    await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z", slotId: marzo.id },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )

    await expect(recordAlcotestSlotStatus(
      { slotId: marzo.id, expectedVersion: 2, status: "not_completed" },
      PRF_ACTOR,
    )).rejects.toBeInstanceOf(AlcotestSlotError)
  })

  /* Sin esto, corregir un "no aplica" a "no hecha" borraría toda huella de que
   * alguien sacó la casilla del denominador: el CHECK anula el trío
   * `not_applicable_*` y la fila deja de decir quién y por qué. */
  it("deja traza de quién sacó la casilla del denominador, y sobrevive a la corrección", async () => {
    const [slot] = await seedSlots()
    const na = await recordAlcotestSlotStatus(
      {
        slotId: slot!.id,
        expectedVersion: 1,
        status: "not_applicable",
        notApplicableReason: "La faena no opera vehículos ni tiene turnos nocturnos.",
      },
      PRF_ACTOR,
    )
    await recordAlcotestSlotStatus(
      { slotId: slot!.id, expectedVersion: na.version, status: "not_completed" },
      PRF_ACTOR,
    )

    // La fila ya no conserva el motivo; la bitácora sí.
    const [fila] = await inMemoryDb.select().from(schema.preventionAlcotestSlots)
      .where(eq(schema.preventionAlcotestSlots.id, slot!.id))
    expect(fila?.notApplicableReason).toBeNull()

    const traza = await readModuleHistory(inMemoryDb, {
      module: "alcotest", entityType: "slot", entityId: slot!.id,
    })
    expect(traza).toHaveLength(2)
    expect(traza[0]).toMatchObject({ actorUserId: USER_PRF, worksiteId: WS_ID })
    expect(traza[0]!.reason).toContain("no opera vehículos")
    expect(traza[1]!.reason).toContain("no hecha")
  })

  it("una casilla de otra faena no se toca aunque se sepa su id", async () => {
    const slots = await seedSlots(WS_OTHER)
    await expect(recordAlcotestSlotStatus(
      { slotId: slots[0]!.id, expectedVersion: 1, status: "not_completed" },
      PRF_ACTOR,
    )).rejects.toThrow()
  })
})

describe("cumplir la casilla con el hecho", () => {
  it("sin evidencia activa no se puede declarar hecha", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const marzo = slots.find((s) => s.kind === "control" && s.scheduledMonth === 3)!

    await expect(recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z", slotId: marzo.id },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )).rejects.toThrow(/evidencia/i)

    // Y el control tampoco quedó registrado: van en la misma transacción.
    expect(await inMemoryDb.select().from(schema.alcoholTests)).toHaveLength(0)
  })

  it("con evidencia, acredita el PDTP con la ruta del archivo y no con un rótulo inventado", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const marzo = slots.find((s) => s.kind === "control" && s.scheduledMonth === 3)!
    await evidenciaEn(marzo.id)

    await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z", slotId: marzo.id },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )

    const [exec] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, N30_ID))
    expect(exec?.evidenceText).toBe(`alcotest/${marzo.id}/planilla-marzo.pdf`)
    expect(exec?.evidenceText).not.toMatch(/Control de alcotest/)

    const [despues] = await inMemoryDb.select().from(schema.preventionAlcotestSlots)
      .where(eq(schema.preventionAlcotestSlots.id, marzo.id))
    expect(despues).toMatchObject({ status: "completed", completedByUserId: USER_PRF })
    expect(despues?.testId).toBeTruthy()
  })

  /* Task 3 — M0.2: el control se registra tarde (abril), pero cumple una
   * casilla planificada para marzo. La celda que el PDTP acredita tiene que
   * ser la de la casilla (marzo), no la del mes en que el control llegó
   * registrado — si no, un control tardío paga un mes que no le corresponde y
   * marzo sigue en cero aunque la casilla ya esté marcada cumplida. */
  it("un control tardío acredita la celda planificada de la casilla, no el mes real del control", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const marzo = slots.find((s) => s.kind === "control" && s.scheduledMonth === 3)!
    expect(marzo.scheduledWeek).toBe(3)
    await evidenciaEn(marzo.id)

    await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-04-10T14:00:00.000Z", slotId: marzo.id },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )

    const [exec] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, N30_ID))
    expect(exec).toMatchObject({ year: PROGRAM_YEAR, month: 3, week: 3 })
  })

  it("un control extraordinario se registra sin casilla y no ocupa ninguna celda", async () => {
    await seedProgramAndActivities()
    await seedSlots()
    await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "noche", performedAt: "2026-03-05T23:00:00.000Z" },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )
    const slots = await listAlcotestSlotsForWorksite([WS_ID], WS_ID, SLOT_YEAR, inMemoryDb as never)
    expect(slots.every((s) => s.status === "pending")).toBe(true)
  })

  it("una casilla de envío no se cumple con un control", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const envio = slots.find((s) => s.kind === "envio")!
    await evidenciaEn(envio.id)

    await expect(recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z", slotId: envio.id },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )).rejects.toThrow(/envío de registros/i)
  })

  it("el envío cumple su casilla y acredita la N°32 con el archivo", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const envioMarzo = slots.find((s) => s.kind === "envio" && s.scheduledMonth === 3)!
    await evidenciaEn(envioMarzo.id)

    await recordAlcoholTestDispatch(
      { worksiteId: WS_ID, year: 2026, month: 2, recipient: "mutual@example.test", slotId: envioMarzo.id },
      USER_PRF, [WS_ID],
    )
    const [exec] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, N32_ID))
    expect(exec?.evidenceText).toBe(`alcotest/${envioMarzo.id}/planilla-marzo.pdf`)
  })

  /* Task 3 — M0.2: el envío se registra tarde (mayo), pero cumple la casilla
   * planificada para marzo (semana 1). La celda que el PDTP acredita tiene
   * que ser la de la casilla, no la del mes en que el envío se registró. */
  it("un envío tardío acredita la celda planificada de la casilla, no el mes real del envío", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const envioMarzo = slots.find((s) => s.kind === "envio" && s.scheduledMonth === 3)!
    expect(envioMarzo.scheduledWeek).toBe(1)
    await evidenciaEn(envioMarzo.id)

    await recordAlcoholTestDispatch(
      {
        worksiteId: WS_ID, year: 2026, month: 2, recipient: "mutual@example.test",
        slotId: envioMarzo.id, sentAt: "2026-05-12T12:00:00.000Z",
      },
      USER_PRF, [WS_ID],
    )

    const [exec] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, N32_ID))
    expect(exec).toMatchObject({ year: PROGRAM_YEAR, month: 3, week: 1 })
  })
})

/**
 * M0.4 (2026-09-22): antes de este cambio, `recordAlcoholTest` y
 * `recordAlcoholTestDispatch` nunca pasaban `autoApproveByUserId` — un
 * alcotest nacía siempre `submitted`, aun con la ruta real de la casilla
 * (ver el comentario que este mismo cambio retiró de la cabecera de
 * `recordAlcoholTest`). Ahora el motor central auto-aprueba cuando el
 * `evidenceRef` es real; `evidenciaEn()` (arriba) no sirve para probarlo
 * porque su `storagePath` no lleva el prefijo `storage/` que
 * `accreditPdtpFromEvent` exige — de ahí el helper propio.
 */
async function evidenciaRealEn(slotId: string) {
  await inMemoryDb.insert(schema.preventionAlcotestSlotEvidence).values({
    id: `alcev-real-${slotId}`,
    slotId,
    fileName: "planilla-real.pdf",
    storagePath: `storage/prevention-alcotest-evidence/${slotId}/planilla-real.pdf`,
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    sha256: "b".repeat(64),
    state: "active",
    uploadedByUserId: USER_PRF,
  })
}

describe("M0.4 — el alcotest se auto-aprueba con evidencia real de la casilla", () => {
  it("un control con la ruta real de storage se auto-aprueba", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const marzo = slots.find((s) => s.kind === "control" && s.scheduledMonth === 3)!
    await evidenciaRealEn(marzo.id)

    await recordAlcoholTest(
      { worksiteId: WS_ID, ...SUBJECT, shift: "dia", performedAt: "2026-03-05T14:00:00.000Z", slotId: marzo.id },
      USER_PRF, ["prevencionista_faena"], [WS_ID],
    )

    const [exec] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, N30_ID))
    expect(exec).toMatchObject({ status: "approved", approvedByUserId: USER_PRF })
  })

  it("el envío con la ruta real de storage también se auto-aprueba", async () => {
    await seedProgramAndActivities()
    const slots = await seedSlots()
    const envioMarzo = slots.find((s) => s.kind === "envio" && s.scheduledMonth === 3)!
    await evidenciaRealEn(envioMarzo.id)

    await recordAlcoholTestDispatch(
      { worksiteId: WS_ID, year: 2026, month: 2, recipient: "mutual@example.test", slotId: envioMarzo.id },
      USER_PRF, [WS_ID],
    )

    const [exec] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, N32_ID))
    expect(exec).toMatchObject({ status: "approved", approvedByUserId: USER_PRF })
  })

  /* Sin casilla no hay ruta real: el conector cae al rótulo sintético
   * `Control de alcotest <id>` y el motor lo deja `submitted` — cubierto ya
   * por "PRF registra y acredita la N°30, no la N°31" arriba, que no pasa
   * `slotId`. */
})

describe("attachAlcotestSlotEvidenceTx", () => {
  it("rechaza adjuntar evidencia a una casilla declarada no aplicable", async () => {
    const [slot] = await seedSlots()
    await recordAlcotestSlotStatus(
      {
        slotId: slot!.id,
        expectedVersion: 1,
        status: "not_applicable",
        notApplicableReason: "La faena no tiene conducción de vehículos ni turnos nocturnos.",
      },
      PRF_ACTOR,
    )

    await expect(inMemoryDb.transaction(async (tx) => attachAlcotestSlotEvidenceTx(tx as never, {
      slotId: slot!.id,
      fileName: "planilla.pdf",
      storagePath: "alcotest/x/planilla.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 10,
      sha256: "b".repeat(64),
      uploadedByUserId: USER_PRF,
    }))).rejects.toBeInstanceOf(AlcotestSlotError)

    expect(await inMemoryDb.select().from(schema.preventionAlcotestSlotEvidence)).toHaveLength(0)
  })
})
