import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getFleetOverview } = await import("@/lib/services/fleet")

/**
 * C-9 (abierto): las lecturas de medidor de Flota salían de `fuel_loads` —0 filas en
 * producción—, así que la columna «Km/Hr» no existía y `kmDriven`/`hoursRun` valían
 * `null` para todo equipo. Ahora salen de `fuel_meter_readings` (fuente `copec_tct`, la
 * misma que lee Analítica), y el recorrido de la ventana de 12 meses sigue las reglas
 * del detector de anomalías: un retroceso sin reset aceptado no se suma, y un reset
 * aceptado parte la serie (CO-023, ítem 7).
 *
 * Las lecturas se siembran en el mes en curso (días ≤ 15) para que la ventana móvil no
 * las suelte con el paso del tiempo.
 */
const { year: YEAR, month: MONTH_NUMBER } = chileDateParts()
const MONTH = `${YEAR}-${String(MONTH_NUMBER).padStart(2, "0")}`
const at = (day: number) => `${MONTH}-${String(day).padStart(2, "0")}T12:00:00.000Z`
/** Hace 14 meses: fuera de la ventana de 12. */
const OLD = new Date(Date.UTC(YEAR, MONTH_NUMBER - 1 - 14, 10, 12)).toISOString()

const IDS = {
  user: "u-fmr", wsA: "ws-fmr-a", wsB: "ws-fmr-b", eq: "eq-fmr", eqGrua: "eq-fmr-grua",
  ruleSalto: "rule-fmr-salto", ruleKm: "rule-fmr-km", ruleHora: "rule-fmr-hora",
  supplier: "sup-fmr", product: "prod-fmr",
} as const

function session(overrides: { permissions?: string[]; worksiteIds?: string[]; isGlobal?: boolean } = {}): Session {
  return {
    user: {
      id: IDS.user, name: "Gerencia", email: "gerencia-fmr@example.com", roles: [],
      permissions: overrides.permissions ?? ["flota:view", "combustibles:view", "combustibles:view_costs"],
      worksiteIds: overrides.worksiteIds ?? [], isGlobal: overrides.isGlobal ?? true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

let seq = 0
async function addVehicle(overrides: Partial<typeof schema.fuelVehicles.$inferInsert> = {}) {
  seq += 1
  const id = overrides.id ?? `veh-fmr-${seq}`
  await db.insert(schema.fuelVehicles).values({
    id, plate: `FM-${String(seq).padStart(4, "0")}`, type: "camion", equipmentTypeId: IDS.eq, worksiteId: IDS.wsA,
    meterType: "odometer", performanceUnit: "km_per_liter", isActive: true, ...overrides,
  })
  return id
}

/** Lecturas `copec_tct` de un equipo, en el orden dado. Devuelve los ids para poder marcar un reset sobre ellas. */
async function addReadings(
  vehicleId: string,
  readings: Array<{ value: number; at: string; source?: "copec_tct" | "gps_onway"; meterType?: "odometer" | "hour_meter" }>,
) {
  const ids: string[] = []
  for (const reading of readings) {
    seq += 1
    const id = `mr-fmr-${seq}`
    ids.push(id)
    await db.insert(schema.fuelMeterReadings).values({
      id, vehicleId, plate: `FM-${vehicleId}`, source: reading.source ?? "copec_tct", sourceRef: `ref-${id}`,
      occurredAt: reading.at, meterType: reading.meterType ?? "odometer", value: reading.value,
    })
  }
  return ids
}

async function addResetCase(readingId: string, vehicleId: string, overrides: Partial<typeof schema.fuelAnomalyCases.$inferInsert> = {}) {
  seq += 1
  await db.insert(schema.fuelAnomalyCases).values({
    id: `case-fmr-${seq}`, ruleId: IDS.ruleKm, ruleCode: "kilometraje_regresivo", severity: "high", vehicleId,
    referenceEntityType: "fuel_meter_reading", referenceEntityId: readingId,
    description: "Lectura de odómetro menor que la carga anterior.", status: "resolved", resolutionKind: "reset_medidor",
    ...overrides,
  })
  return `case-fmr-${seq}`
}

const rowOf = (rows: Awaited<ReturnType<typeof getFleetOverview>>, id: string) => rows.find((row) => row.id === id)!

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await pg.exec("SET TIME ZONE 'UTC'")
  await db.insert(schema.users).values({ id: IDS.user, name: "Gerencia", email: "gerencia-fmr@example.com", hashedPassword: "x", isActive: true })
  await db.insert(schema.worksites).values([
    { id: IDS.wsA, name: "Faena A", code: "FMR-A", isActive: true },
    { id: IDS.wsB, name: "Faena B", code: "FMR-B", isActive: true },
  ])
  await db.insert(schema.fuelEquipmentTypes).values([
    { id: IDS.eq, slug: "camion-fmr", name: "Camión" },
    { id: IDS.eqGrua, slug: "grua-fmr", name: "Grúa" },
  ])
  await db.insert(schema.fuelSuppliers).values({ id: IDS.supplier, name: "Copec" })
  await db.insert(schema.fuelProducts).values({ id: IDS.product, code: "fmr-diesel", name: "Diésel", category: "diesel", unit: "liter" })
  await db.insert(schema.fuelAnomalyRules).values([
    { id: IDS.ruleSalto, code: "salto_medidor_implausible", name: "Salto de medidor implausible", severity: "high", isActive: true,
      config: JSON.stringify({ maxKmPerDay: 1500, maxHoursPerDay: 24, equipmentTypes: { "grua-fmr": { maxKmPerDay: 100 } } }) },
    { id: IDS.ruleKm, code: "kilometraje_regresivo", name: "Kilometraje regresivo", severity: "high", isActive: true, config: "{}" },
    { id: IDS.ruleHora, code: "horometro_regresivo", name: "Horómetro regresivo", severity: "high", isActive: true, config: "{}" },
  ])
}, 60_000)

afterAll(async () => { await pg.close() })

describe("getFleetOverview · lecturas de medidor desde fuel_meter_readings", () => {
  it("la última lectura y el recorrido salen del detalle de Copec, no de fuel_loads", async () => {
    const id = await addVehicle()
    await addReadings(id, [
      // Fuera de la ventana: si entrara, el par con la primera lectura de abajo sumaría 9.999 km.
      { value: 1, at: OLD },
      { value: 10_000, at: at(1) },
      { value: 10_400, at: at(3) },
      { value: 11_000, at: at(6) },
      // Otra fuente (GPS): su desfase propio no se mezcla con el de Copec.
      { value: 999_999, at: at(7), source: "gps_onway" },
    ])
    // La serie facturada no aporta lecturas: una carga con 888.888 km no mueve nada.
    await db.insert(schema.fuelLoads).values({
      id: "fl-fmr-ignored", loadDate: `${MONTH}-08`, month: MONTH, serviceType: "TCT", vehicleId: id, fuelSupplierId: IDS.supplier,
      worksiteId: IDS.wsA, product: "PETROLEO DIESEL", productId: IDS.product, liters: 50, baseAmount: 50_000, totalAmount: 50_000,
      status: "registered", createdBy: IDS.user, odometerReading: 888_888,
    })

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ lastOdometerReading: 11_000, lastHourMeterReading: null, kmDriven: 1_000, hoursRun: null, meterSeriesIncomplete: false })
  })

  it("un equipo con horómetro: horas corridas y última lectura en horas; el odómetro queda nulo", async () => {
    const id = await addVehicle({ meterType: "hour_meter", performanceUnit: "liters_per_hour" })
    await addReadings(id, [
      { value: 100, at: at(1), meterType: "hour_meter" },
      { value: 108, at: at(2), meterType: "hour_meter" },
      { value: 120, at: at(4), meterType: "hour_meter" },
    ])

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ lastHourMeterReading: 120, lastOdometerReading: null, hoursRun: 20, kmDriven: null, meterSeriesIncomplete: false })
  })

  it("el horómetro respeta las 24 horas por día de la regla: más que eso no se suma", async () => {
    const id = await addVehicle({ meterType: "hour_meter", performanceUnit: "liters_per_hour" })
    await addReadings(id, [
      { value: 100, at: at(1), meterType: "hour_meter" },
      { value: 140, at: at(2), meterType: "hour_meter" },
    ])

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ lastHourMeterReading: 140, hoursRun: null, meterSeriesIncomplete: true })
  })

  it("el recorrido sólo se informa en la unidad de rendimiento del equipo", async () => {
    const id = await addVehicle({ performanceUnit: "not_applicable" })
    await addReadings(id, [{ value: 5_000, at: at(1) }, { value: 5_300, at: at(3) }])

    const row = rowOf(await getFleetOverview(session()), id)

    // La última lectura se ve siempre; el recorrido sólo donde Flota sabe rotular su unidad.
    expect(row).toMatchObject({ lastOdometerReading: 5_300, kmDriven: null, hoursRun: null })
  })

  it("un equipo sin lecturas en la ventana queda sin valores, no en cero", async () => {
    const id = await addVehicle()
    await addReadings(id, [{ value: 50_000, at: OLD }])

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ lastOdometerReading: null, kmDriven: null, meterSeriesIncomplete: false })
  })
})

describe("getFleetOverview · retrocesos y resets de medidor", () => {
  it("un retroceso sin reset aceptado no se suma ni vuelve negativo el recorrido; queda marcado", async () => {
    const id = await addVehicle()
    await addReadings(id, [
      { value: 10_000, at: at(1) },
      { value: 10_300, at: at(3) },
      { value: 1_030, at: at(5) },
      { value: 10_600, at: at(8) },
      { value: 10_900, at: at(10) },
    ])

    const row = rowOf(await getFleetOverview(session()), id)

    // 300 + 300: ni el −9.270 ni el +9.570 de vuelta son recorrido. La última lectura sigue siendo la más reciente.
    expect(row).toMatchObject({ kmDriven: 600, lastOdometerReading: 10_900, meterSeriesIncomplete: true })
  })

  it("una serie que sólo retrocede (posible medidor nuevo sin validar) no tiene recorrido: es «—», no un negativo", async () => {
    const id = await addVehicle()
    await addReadings(id, [{ value: 300_457, at: at(1) }, { value: 40_615, at: at(5) }])

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ kmDriven: null, lastOdometerReading: 40_615, meterSeriesIncomplete: true })
  })

  it("un salto imposible (un dígito de más) no infla el recorrido", async () => {
    const id = await addVehicle()
    await addReadings(id, [
      { value: 100_000, at: at(1) },
      { value: 100_200, at: at(3) },
      { value: 1_000_000, at: at(5) },
      { value: 100_500, at: at(7) },
      { value: 100_800, at: at(9) },
    ])

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ kmDriven: 500, meterSeriesIncomplete: true })
  })

  it("la cota del salto es la de la regla, con override por tipo de equipo", async () => {
    const id = await addVehicle({ equipmentTypeId: IDS.eqGrua })
    // 300 km en un día: bajo los 1.500 de la regla, sobre los 100 que declara el tipo «grúa».
    await addReadings(id, [{ value: 1_000, at: at(1) }, { value: 1_300, at: at(2) }])

    const row = rowOf(await getFleetOverview(session()), id)

    expect(row).toMatchObject({ kmDriven: null, meterSeriesIncomplete: true })
  })

  describe("el caso de medidor regresivo sobre la lectura", () => {
    let vehicleId: string
    let caseId: string
    const advanceOf = async () => rowOf(await getFleetOverview(session()), vehicleId)

    beforeAll(async () => {
      vehicleId = await addVehicle()
      const ids = await addReadings(vehicleId, [
        { value: 10_000, at: at(1) },
        { value: 10_400, at: at(3) },
        { value: 1_000, at: at(5) },
        { value: 1_300, at: at(8) },
        { value: 1_500, at: at(10) },
      ])
      caseId = await addResetCase(ids[2]!, vehicleId, { status: "open", resolutionKind: null })
    })

    it("abierto: sigue siendo un posible reset por verificar, y el retroceso no se suma", async () => {
      // 400 antes; el retroceso y el par siguiente (sin base fiable) quedan fuera; +200 al final.
      expect(await advanceOf()).toMatchObject({ kmDriven: 600, meterSeriesIncomplete: true })
    })

    it("cerrado como lectura corregida NO corta la serie: fue un error de tipeo, no un medidor nuevo", async () => {
      await db.update(schema.fuelAnomalyCases).set({ status: "resolved", resolutionKind: "lectura_corregida" }).where(eq(schema.fuelAnomalyCases.id, caseId))

      expect(await advanceOf()).toMatchObject({ kmDriven: 600, meterSeriesIncomplete: true })
    })

    it("cerrado como reset de medidor: la serie parte ahí, y el recorrido suma ambos tramos sin marca de error", async () => {
      await db.update(schema.fuelAnomalyCases).set({ status: "resolved", resolutionKind: "reset_medidor" }).where(eq(schema.fuelAnomalyCases.id, caseId))

      // 400 antes del reset + 300 + 200 después; 10.400 → 1.000 es un tramo desconocido, no un error.
      expect(await advanceOf()).toMatchObject({ kmDriven: 900, meterSeriesIncomplete: false, lastOdometerReading: 1_500 })
    })

    it("descartado como reset de medidor vale igual", async () => {
      await db.update(schema.fuelAnomalyCases).set({ status: "dismissed", resolutionKind: "reset_medidor" }).where(eq(schema.fuelAnomalyCases.id, caseId))

      expect(await advanceOf()).toMatchObject({ kmDriven: 900, meterSeriesIncomplete: false })
    })

    it("reabierto, vuelve a ser un retroceso sin aceptar", async () => {
      await db.update(schema.fuelAnomalyCases).set({ status: "reopened", resolutionKind: null }).where(eq(schema.fuelAnomalyCases.id, caseId))

      expect(await advanceOf()).toMatchObject({ kmDriven: 600, meterSeriesIncomplete: true })
    })

    it("un reset aceptado sobre una carga facturada (fuel_load) no corta la serie del detalle", async () => {
      await db.update(schema.fuelAnomalyCases).set({ status: "resolved", resolutionKind: "reset_medidor", referenceEntityType: "fuel_load" }).where(eq(schema.fuelAnomalyCases.id, caseId))

      expect(await advanceOf()).toMatchObject({ kmDriven: 600, meterSeriesIncomplete: true })
    })
  })
})

describe("getFleetOverview · permisos y alcance de las lecturas", () => {
  it("sin combustibles:view no hay lecturas ni recorrido", async () => {
    const id = await addVehicle()
    await addReadings(id, [{ value: 1_000, at: at(1) }, { value: 1_300, at: at(3) }])

    const row = rowOf(await getFleetOverview(session({ permissions: ["flota:view"] })), id)

    expect(row).toMatchObject({ lastOdometerReading: null, lastHourMeterReading: null, kmDriven: null, hoursRun: null, meterSeriesIncomplete: null })
  })

  it("sin view_costs las lecturas siguen visibles: no son un monto", async () => {
    const id = await addVehicle()
    await addReadings(id, [{ value: 2_000, at: at(1) }, { value: 2_500, at: at(3) }])

    const row = rowOf(await getFleetOverview(session({ permissions: ["flota:view", "combustibles:view"] })), id)

    expect(row).toMatchObject({ lastOdometerReading: 2_500, kmDriven: 500 })
  })

  it("una faena fuera del alcance no aporta equipos ni lecturas", async () => {
    const inside = await addVehicle({ worksiteId: IDS.wsA })
    const outside = await addVehicle({ worksiteId: IDS.wsB })
    await addReadings(inside, [{ value: 3_000, at: at(1) }, { value: 3_100, at: at(2) }])
    await addReadings(outside, [{ value: 7_000, at: at(1) }, { value: 7_100, at: at(2) }])

    const rows = await getFleetOverview(session({ isGlobal: false, worksiteIds: [IDS.wsA] }))

    expect(rows.map((row) => row.id)).toContain(inside)
    expect(rows.map((row) => row.id)).not.toContain(outside)
    expect(rowOf(rows, inside)).toMatchObject({ lastOdometerReading: 3_100, kmDriven: 100 })
  })

  it("la faena elegida en el tablero acota las lecturas a esa faena", async () => {
    const inB = await addVehicle({ worksiteId: IDS.wsB })
    const inA = await addVehicle({ worksiteId: IDS.wsA })
    await addReadings(inB, [{ value: 6_000, at: at(1) }, { value: 6_050, at: at(2) }])
    await addReadings(inA, [{ value: 8_000, at: at(1) }, { value: 8_050, at: at(2) }])

    const rows = await getFleetOverview(session(), IDS.wsB)

    expect(rows.map((row) => row.id)).toContain(inB)
    expect(rows.map((row) => row.id)).not.toContain(inA)
    expect(rowOf(rows, inB)).toMatchObject({ lastOdometerReading: 6_050, kmDriven: 50 })
  })

  it("acota por equipos cuando se piden ids (la página de la lista)", async () => {
    const wanted = await addVehicle()
    const other = await addVehicle()
    await addReadings(wanted, [{ value: 4_000, at: at(1) }, { value: 4_200, at: at(2) }])
    await addReadings(other, [{ value: 9_000, at: at(1) }, { value: 9_200, at: at(2) }])

    const rows = await getFleetOverview(session(), undefined, [wanted])

    expect(rows.map((row) => row.id)).toEqual([wanted])
    expect(rows[0]).toMatchObject({ lastOdometerReading: 4_200, kmDriven: 200 })
  })
})

/**
 * Flota muestra la última lectura tal cual, pero la marca cuando el detector de anomalías la
 * objeta y nadie ha decidido todavía: un caso ABIERTO (`open`, `in_review` o `reopened`) sobre
 * esa misma lectura. Cualquier cierre —`resuelto` o `descartado`, con la resolución que sea—
 * apaga la marca: lo decidido ya no pide a nadie que la mire.
 */
describe("getFleetOverview · lectura objetada (caso abierto sobre la última lectura)", () => {
  const objectionOf = async (id: string, s: Session = session()) => rowOf(await getFleetOverview(s), id).lastReadingObjection

  /** Un equipo con tres lecturas; devuelve sus ids en orden (la tercera es la última). */
  async function vehicleWithReadings(overrides: Partial<typeof schema.fuelVehicles.$inferInsert> = {}) {
    const vehicleId = await addVehicle(overrides)
    const readingIds = await addReadings(vehicleId, [
      { value: 10_000, at: at(1) },
      { value: 10_300, at: at(3) },
      { value: 1_030, at: at(5) },
    ])
    return { vehicleId, readingIds }
  }
  const openCase = (readingId: string, vehicleId: string, overrides: Partial<typeof schema.fuelAnomalyCases.$inferInsert> = {}) =>
    addResetCase(readingId, vehicleId, { status: "open", resolutionKind: null, worksiteId: IDS.wsA, ...overrides })

  it("un caso abierto sobre la última lectura la marca, con el id del caso y el nombre de la regla", async () => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    const caseId = await openCase(readingIds[2]!, vehicleId)

    const row = rowOf(await getFleetOverview(session()), vehicleId)

    // La lectura se sigue mostrando tal cual (1.030 km): la marca es un aviso, no una corrección.
    expect(row).toMatchObject({ lastOdometerReading: 1_030, lastReadingObjection: { caseId, ruleLabel: "Kilometraje regresivo" } })
  })

  it.each(["in_review", "reopened"] as const)("un caso «%s» también cuenta como abierto", async (status) => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    const caseId = await openCase(readingIds[2]!, vehicleId, { status })

    expect(await objectionOf(vehicleId)).toEqual({ caseId, ruleLabel: "Kilometraje regresivo" })
  })

  it.each([
    ["resolved", "reset_medidor"],
    ["resolved", "lectura_corregida"],
    ["resolved", null],
    ["dismissed", "reset_medidor"],
    ["dismissed", null],
  ] as const)("un caso %s (resolución %s) apaga la marca", async (status, resolutionKind) => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    await openCase(readingIds[2]!, vehicleId, { status, resolutionKind })

    expect(await objectionOf(vehicleId)).toBeNull()
  })

  it("un caso abierto sobre una lectura anterior no marca la última", async () => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    await openCase(readingIds[1]!, vehicleId)

    expect(await objectionOf(vehicleId)).toBeNull()
  })

  it("sin ningún caso, la marca es null (no undefined ni un objeto vacío)", async () => {
    const { vehicleId } = await vehicleWithReadings()

    expect(await objectionOf(vehicleId)).toBeNull()
  })

  it("un caso sobre otro tipo de registro con el mismo id no marca la lectura", async () => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    await openCase(readingIds[2]!, vehicleId, { referenceEntityType: "fuel_load" })

    expect(await objectionOf(vehicleId)).toBeNull()
  })

  it("un equipo con horómetro: el caso del horómetro regresivo marca su última lectura en horas", async () => {
    const vehicleId = await addVehicle({ meterType: "hour_meter", performanceUnit: "liters_per_hour" })
    const readingIds = await addReadings(vehicleId, [
      { value: 100, at: at(1), meterType: "hour_meter" },
      { value: 120, at: at(4), meterType: "hour_meter" },
      { value: 90, at: at(6), meterType: "hour_meter" },
    ])
    const caseId = await openCase(readingIds[2]!, vehicleId, { ruleId: IDS.ruleHora, ruleCode: "horometro_regresivo" })

    expect(rowOf(await getFleetOverview(session()), vehicleId)).toMatchObject({
      lastHourMeterReading: 90, lastReadingObjection: { caseId, ruleLabel: "Horómetro regresivo" },
    })
  })

  it("con dos casos abiertos sobre la misma lectura gana el más antiguo, siempre el mismo", async () => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    const newer = await openCase(readingIds[2]!, vehicleId, { ruleId: IDS.ruleSalto, ruleCode: "salto_medidor_implausible", detectedAt: "2026-01-02T10:00:00.000Z" })
    const older = await openCase(readingIds[2]!, vehicleId, { detectedAt: "2026-01-01T10:00:00.000Z" })

    const objection = await objectionOf(vehicleId)

    expect(objection).toEqual({ caseId: older, ruleLabel: "Kilometraje regresivo" })
    expect(objection?.caseId).not.toBe(newer)
  })

  it("un equipo sin lecturas en la ventana no tiene marca", async () => {
    const vehicleId = await addVehicle()
    const [oldReading] = await addReadings(vehicleId, [{ value: 50_000, at: OLD }])
    await openCase(oldReading!, vehicleId)

    expect(await objectionOf(vehicleId)).toBeNull()
  })

  it("sin combustibles:view la marca es null: es la misma puerta que la lectura", async () => {
    const { vehicleId, readingIds } = await vehicleWithReadings()
    await openCase(readingIds[2]!, vehicleId)

    expect(await objectionOf(vehicleId, session({ permissions: ["flota:view"] }))).toBeNull()
  })

  it("un alcance de faena sólo ve la marca de sus propios equipos; el de otra faena ni aparece", async () => {
    const inside = await vehicleWithReadings({ worksiteId: IDS.wsA })
    const outside = await vehicleWithReadings({ worksiteId: IDS.wsB })
    const insideCase = await openCase(inside.readingIds[2]!, inside.vehicleId, { worksiteId: IDS.wsA })
    await openCase(outside.readingIds[2]!, outside.vehicleId, { worksiteId: IDS.wsB })

    const rows = await getFleetOverview(session({ isGlobal: false, worksiteIds: [IDS.wsA] }))

    expect(rows.map((row) => row.id)).not.toContain(outside.vehicleId)
    expect(rowOf(rows, inside.vehicleId).lastReadingObjection).toEqual({ caseId: insideCase, ruleLabel: "Kilometraje regresivo" })
  })

  it("no ofrece un caso que la bandeja le rechazaría: el caso es de una faena fuera de su alcance", async () => {
    const { vehicleId, readingIds } = await vehicleWithReadings({ worksiteId: IDS.wsA })
    await openCase(readingIds[2]!, vehicleId, { worksiteId: IDS.wsB })

    expect(await objectionOf(vehicleId, session({ isGlobal: false, worksiteIds: [IDS.wsA] }))).toBeNull()
  })
})
