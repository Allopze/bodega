import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getAnalyticsDashboard } = await import("@/lib/services/analytics-module/dashboard")
const { accountableProviderTransactionsWhere } = await import("@/lib/combustibles/load-status")

/**
 * C-9 (AUDITORIA_VISUALIZACIONES_CHOME.md, Anexo C): `/analitica` calculaba el
 * gasto en combustible desde `fuel_loads`, que en producción tiene 0 filas,
 * mientras los 5.671 registros de Copec viven en `fuel_provider_transactions`.
 * El tile decía «Combustible $0».
 *
 * Estas pruebas fijan que Analítica lee el libro del proveedor con la MISMA
 * regla que la conciliación (`accountableProviderTransactionsWhere`): aceptadas,
 * vigentes (no reemplazadas) y sin contar dos veces el agregado mensual TCT que
 * convive con su propio detalle.
 */

const FUEL_SUPPLIER = "fs-copec"
const PLATE_A = "AA-0001"

function session(overrides: { worksiteIds?: string[]; isGlobal?: boolean; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: overrides.isGlobal ?? true,
      roles: [],
      worksiteIds: overrides.worksiteIds ?? [],
      permissions: overrides.permissions ?? ["analytics:view", "combustibles:view", "combustibles:view_costs"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

let counter = 0
function tx(overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert>): typeof schema.fuelProviderTransactions.$inferInsert {
  counter += 1
  return {
    id: `apt-${counter}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `apt-idk-${counter}`,
    fingerprint: `apt-fp-${counter}`, sourceRowKey: `apt-row-${counter}`, payloadHash: `apt-ph-${counter}`,
    supplierId: FUEL_SUPPLIER, worksiteId: IDS.wsA, vehicleId: IDS.vA, sourcePlate: PLATE_A,
    occurredAt: "2026-03-10T12:00:00.000Z", quantity: 100, amount: 100_000, status: "accepted", granularity: "transaction",
    ...overrides,
  }
}

/** Cobertura de un mes para las cuatro cuentas de Copec, como la deja la sincronización. */
function coverageRows(month: string, status: string, rowsAccepted: number, sourceAvailability = "available"): Array<typeof schema.fuelProviderPeriodCoverage.$inferInsert> {
  return ["tct:diesel", "tct:bluemax", "tae:diesel", "tae:bluemax"].map((account, index) => ({
    id: `cov-${month}-${account}`, provider: "copec", sourceAccount: account, channel: account.slice(0, 3).toUpperCase(),
    product: account.slice(4), periodMonth: `${month}-01`, status, sourceAvailability,
    rowsReceived: index === 0 ? rowsAccepted : 0, rowsAccepted: index === 0 ? rowsAccepted : 0,
  }))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  // La sesión corre en UTC, como el despliegue.
  await pg.exec("SET TIME ZONE 'UTC'")
  await seedControlFixtures(db)
  await db.insert(schema.fuelSuppliers).values({ id: FUEL_SUPPLIER, name: "Copec de prueba" })
  await db.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: "2026-01-01", requestedTo: "2026-04-30", correlationId: "corr-analytics-fuel" })
  await db.insert(schema.suppliers).values({ id: "ana-fuel-supplier", name: "Proveedor de compras" })
  // Una OC de enero: el lado «compras» de la tendencia de 12 meses.
  await db.insert(schema.purchaseOrders).values({
    id: "ana-fuel-oc", code: "OC-ANA-FUEL", worksiteId: IDS.wsA, supplierId: "ana-fuel-supplier", createdBy: IDS.user,
    // CHART-033: el gasto en OC se fecha por emisión (`issuedAt`), como Finanzas del tablero; una OC `sent` sin
    // fecha de emisión ya no es gasto.
    status: "sent", totalAmount: 500_000, createdAt: "2026-01-15T15:00:00.000Z", issuedAt: "2026-01-15T15:00:00.000Z",
  })
  await db.insert(schema.fuelProviderTransactions).values([
    // Marzo, patente A: tres transacciones que sí cuentan.
    tx({ id: "p-1", quantity: 100, amount: 100_000, occurredAt: "2026-03-10T12:00:00.000Z" }),
    tx({ id: "p-2", quantity: 50, amount: 60_000, occurredAt: "2026-03-20T12:00:00.000Z" }),
    tx({ id: "p-3", quantity: 10, amount: 5_000, occurredAt: "2026-03-28T12:00:00.000Z" }),
    // Agregado mensual TCT de marzo de la misma patente y cuenta: el informe trae ambos
    // niveles del MISMO litro. Contarlo duplicaría 165.000 pesos.
    tx({ id: "p-agg-mar", granularity: "period_aggregate", quantity: 160, amount: 165_000, occurredAt: "2026-03-01" }),
    // Reemplazada por otra aceptada: la vieja no cuenta, la nueva sí.
    tx({ id: "p-old", worksiteId: IDS.wsB, vehicleId: IDS.vB, sourcePlate: "BB-0002", quantity: 77, amount: 7_700, occurredAt: "2026-03-12T12:00:00.000Z" }),
    tx({ id: "p-new", worksiteId: IDS.wsB, vehicleId: IDS.vB, sourcePlate: "BB-0002", quantity: 80, amount: 9_000, occurredAt: "2026-03-12T12:00:00.000Z", supersedesId: "p-old" }),
    // Ni pendientes ni excluidas ni rechazadas son consumo.
    tx({ id: "p-pending", status: "pending", quantity: 9_999, amount: 999_999, occurredAt: "2026-03-11T12:00:00.000Z" }),
    tx({ id: "p-excluded", status: "excluded", quantity: 8_888, amount: 888_888, occurredAt: "2026-03-11T12:00:00.000Z" }),
    tx({ id: "p-rejected", status: "rejected", quantity: 7_777, amount: 777_777, occurredAt: "2026-03-11T12:00:00.000Z" }),
    // Recepción en estanque (TAE): es compra de combustible aunque no tenga vehículo.
    tx({ id: "p-tae", sourceAccount: "tae:diesel", vehicleId: null, sourcePlate: null, quantity: 1_000, amount: 1_200_000, occurredAt: "2026-03-15T12:00:00.000Z" }),
    // Febrero: fuera del período de marzo, dentro de la tendencia de 12 meses y de la comparación.
    tx({ id: "p-feb", quantity: 40, amount: 200_000, occurredAt: "2026-02-10T12:00:00.000Z" }),
    // Agregado de abril SIN detalle de ese mes: sí cuenta, y representa las 3 cargas de su `detalle`.
    tx({
      id: "p-agg-apr", granularity: "period_aggregate", quantity: 70, amount: 80_000, occurredAt: "2026-04-01",
      rawPayload: { detalle: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    }),
    // Patente nula (p. ej. una recepción sin patente): el agregado sigue cubierto por el detalle
    // de su MISMA cuenta y mes —`is not distinct from`—, y uno de otra cuenta sin detalle cuenta.
    tx({ id: "p-det-null", vehicleId: null, sourcePlate: null, quantity: 5, amount: 10, occurredAt: "2026-05-10T12:00:00.000Z" }),
    tx({ id: "p-agg-null", granularity: "period_aggregate", vehicleId: null, sourcePlate: null, quantity: 99, amount: 99, occurredAt: "2026-05-01" }),
    tx({ id: "p-agg-bluemax", granularity: "period_aggregate", sourceAccount: "tct:bluemax", vehicleId: null, sourcePlate: null, quantity: 20, amount: 20, occurredAt: "2026-05-01" }),
  ])
  // Cobertura (C-4/C-10): enero cerrado y VACÍO (un cero real); febrero a mayo con datos.
  // Ningún otro mes tiene fila: el proveedor no dijo nada de él.
  await db.insert(schema.fuelProviderPeriodCoverage).values([
    ...coverageRows("2026-01", "complete", 0),
    ...coverageRows("2026-02", "complete", 1),
    ...coverageRows("2026-03", "complete", 6),
    ...coverageRows("2026-04", "incomplete", 1),
    ...coverageRows("2026-05", "complete", 3),
  ])
  await db.insert(schema.fuelMeterReadings).values([
    { id: "mr-1", vehicleId: IDS.vA, plate: PLATE_A, source: "copec_tct", sourceRef: "g-1", occurredAt: "2026-03-10T12:00:00.000Z", meterType: "odometer", value: 12_345 },
    { id: "mr-2", vehicleId: IDS.vA, plate: PLATE_A, source: "copec_tct", sourceRef: "g-2", occurredAt: "2026-03-20T12:00:00.000Z", meterType: "odometer", value: 12_500 },
    { id: "mr-3", vehicleId: IDS.vB, plate: "BB-0002", source: "copec_tct", sourceRef: "g-3", occurredAt: "2026-03-12T12:00:00.000Z", meterType: "hour_meter", value: 99 },
  ])
}, 60_000)

afterAll(async () => { await pg.close() })

describe("accountableProviderTransactionsWhere (regla canónica compartida con la conciliación)", () => {
  it("deja sólo aceptadas vigentes y sin el agregado TCT que tiene detalle", async () => {
    const rows = await db.select({ id: schema.fuelProviderTransactions.id })
      .from(schema.fuelProviderTransactions)
      .where(accountableProviderTransactionsWhere())
    // Fuera: p-agg-mar y p-agg-null (tienen detalle), p-old (reemplazada), p-pending, p-excluded, p-rejected.
    expect(rows.map((row) => row.id).sort()).toEqual(["p-1", "p-2", "p-3", "p-agg-apr", "p-agg-bluemax", "p-det-null", "p-feb", "p-new", "p-tae"])
  })
})

describe("getAnalyticsDashboard · gasto en combustible desde el libro del proveedor (C-9)", () => {
  const MARCH = { fromDate: "2026-03-01", toDate: "2026-03-31" }

  it("el KPI de combustible es la suma bajo la regla canónica: sin doble conteo, reemplazadas ni no aceptadas", async () => {
    const data = await getAnalyticsDashboard(session(), MARCH)

    // 100.000 + 60.000 + 5.000 (marzo) + 9.000 (la vigente) + 1.200.000 (TAE).
    expect(data.kpis.fuelAmount).toBe(1_374_000)
    expect(data.kpis.fuelLiters).toBe(1_240)
    expect(data.kpis.fuelLoadCount).toBe(5)
    expect(data.kpis.totalSpend).toBe(1_374_000)
  })

  it("la misma cifra aparece en el desglose por tipo, la serie mensual, las faenas y el proveedor", async () => {
    const data = await getAnalyticsDashboard(session(), MARCH)

    expect(data.spendByModule).toEqual([{ module: "Combustible", totalAmount: 1_374_000 }])
    expect(data.spendByMonth.find((row) => row.month === "2026-03")?.fuelAmount).toBe(1_374_000)
    expect(data.topWorksites).toEqual([
      { id: IDS.wsA, name: "Faena A", totalAmount: 1_365_000 },
      { id: IDS.wsB, name: "Faena B", totalAmount: 9_000 },
    ])
    expect(data.topSuppliers).toEqual([
      { id: FUEL_SUPPLIER, name: "Copec de prueba", module: "Combustible", totalAmount: 1_374_000, count: 5 },
    ])
  })

  it("el ranking de vehículos suma por patente y no incluye la recepción TAE (sin vehículo)", async () => {
    const data = await getAnalyticsDashboard(session(), MARCH)

    expect(data.vehicleCosts.map((row) => ({ plate: row.plate, amount: row.totalFuelAmount, liters: row.totalLiters, loads: row.loadCount }))).toEqual([
      { plate: PLATE_A, amount: 165_000, liters: 160, loads: 3 },
      { plate: "BB-0002", amount: 9_000, liters: 80, loads: 1 },
    ])
  })

  it("las últimas lecturas de medidor salen de las lecturas del proveedor, no de fuel_loads", async () => {
    const data = await getAnalyticsDashboard(session(), MARCH)
    const a = data.vehicleCosts.find((row) => row.plate === PLATE_A)
    const b = data.vehicleCosts.find((row) => row.plate === "BB-0002")

    // La más reciente, no la mayor ni la primera (CO-023).
    expect(a).toMatchObject({ lastOdometerReading: 12_500, lastHourMeterReading: null })
    expect(b).toMatchObject({ lastOdometerReading: null, lastHourMeterReading: 99 })
    expect(data.dataGaps).toEqual([])
  })

  it("el agregado mensual sin detalle cuenta, y representa las cargas de su detalle", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-04-01", toDate: "2026-04-30" })

    expect(data.kpis.fuelAmount).toBe(80_000)
    expect(data.kpis.fuelLiters).toBe(70)
    expect(data.kpis.fuelLoadCount).toBe(3)
  })

  it("la comparación usa el período anterior de igual duración sobre la misma regla", async () => {
    const data = await getAnalyticsDashboard(session(), MARCH)

    // 29-ene a 28-feb: sólo la compra de febrero.
    expect(data.kpis.previousTotalSpend).toBe(200_000)
  })

  it("respeta el período, la faena y el vehículo del filtro", async () => {
    const week = await getAnalyticsDashboard(session(), { fromDate: "2026-03-18", toDate: "2026-03-22" })
    expect(week.kpis.fuelAmount).toBe(60_000)

    const worksite = await getAnalyticsDashboard(session(), { ...MARCH, worksiteId: IDS.wsB })
    expect(worksite.kpis.fuelAmount).toBe(9_000)

    const vehicle = await getAnalyticsDashboard(session(), { ...MARCH, vehicleId: IDS.vA })
    expect(vehicle.kpis.fuelAmount).toBe(165_000)
    expect(vehicle.vehicleCosts.map((row) => row.plate)).toEqual([PLATE_A])
  })

  it("respeta el alcance de faena del usuario", async () => {
    const scoped = await getAnalyticsDashboard(session({ isGlobal: false, worksiteIds: [IDS.wsB] }), MARCH)
    expect(scoped.kpis.fuelAmount).toBe(9_000)
    expect(scoped.topWorksites.map((row) => row.id)).toEqual([IDS.wsB])

    const none = await getAnalyticsDashboard(session({ isGlobal: false, worksiteIds: [] }), MARCH)
    expect(none.kpis.fuelAmount).toBe(0)
    expect(none.vehicleCosts).toEqual([])
  })

  it("sin combustibles:view_costs no se calcula ningún monto, sólo litros", async () => {
    const data = await getAnalyticsDashboard(session({ permissions: ["analytics:view", "combustibles:view"] }), MARCH)

    expect(data.kpis.fuelAmount).toBe(0)
    expect(data.kpis.fuelLiters).toBe(1_240)
    expect(data.spendByModule).toEqual([])
    expect(data.vehicleCosts).toEqual([])
  })
})

describe("getAnalyticsDashboard · tendencia mensual de 12 meses (C-10)", () => {
  it("cubre los 12 meses civiles que terminan en el mes de `hasta`, sin depender de `desde`", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-03-20", toDate: "2026-03-25" })

    expect(data.spendByMonth.map((row) => row.month)).toEqual([
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ])
    // Compras de enero y combustible de febrero aparecen aunque el período sea de 6 días.
    // Enero está cerrado y vacío en la cobertura: su combustible es un cero REAL.
    expect(data.spendByMonth.find((row) => row.month === "2026-01")).toMatchObject({ purchasingAmount: 500_000, fuelAmount: 0, totalAmount: 500_000 })
    expect(data.spendByMonth.find((row) => row.month === "2026-02")).toMatchObject({ purchasingAmount: 0, fuelAmount: 200_000, totalAmount: 200_000 })
    // Los meses sin movimiento no desaparecen del eje: las compras quedan en cero.
    expect(data.spendByMonth.find((row) => row.month === "2025-07")).toMatchObject({ purchasingAmount: 0 })
  })

  it("los KPI siguen siendo del período elegido aunque la tendencia mire 12 meses", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-03-20", toDate: "2026-03-25" })

    expect(data.kpis.fuelAmount).toBe(60_000)
    expect(data.kpis.totalSpend).toBe(60_000)
  })

  it("marca como parcial el mes de `hasta` cuando el día elegido no cierra el mes, y lo corta en `hasta`", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-03-20", toDate: "2026-03-25" })
    const march = data.spendByMonth.at(-1)!

    expect(march.month).toBe("2026-03")
    expect(march.partial).toBe(true)
    // Hasta el 25: sin la carga del 28 (5.000). 100.000 + 60.000 + 9.000 + 1.200.000.
    expect(march.fuelAmount).toBe(1_369_000)
    expect(data.spendByMonth.slice(0, -1).every((row) => row.partial === false)).toBe(true)
  })

  it("un mes cerrado y pasado no es parcial", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-03-01", toDate: "2026-03-31" })

    expect(data.spendByMonth.at(-1)).toMatchObject({ month: "2026-03", partial: false, fuelAmount: 1_374_000 })
  })

  it("respeta faena y vehículo, pero no la ventana de fechas", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-03-20", toDate: "2026-03-25", worksiteId: IDS.wsB })

    expect(data.spendByMonth.find((row) => row.month === "2026-03")?.fuelAmount).toBe(9_000)
    expect(data.spendByMonth.find((row) => row.month === "2026-02")?.fuelAmount).toBe(0)
  })
})

describe("getAnalyticsDashboard · meses sin datos del proveedor en la tendencia (C-4 / C-10)", () => {
  const TREND = { fromDate: "2026-03-20", toDate: "2026-03-25" }

  it("un mes sin cobertura ni transacciones es un hueco (null), no un cero de combustible", async () => {
    const data = await getAnalyticsDashboard(session(), TREND)

    // 2025-04 a 2025-12: el proveedor no dijo nada. Las compras siguen en cero real.
    for (const month of ["2025-04", "2025-07", "2025-12"]) {
      expect(data.spendByMonth.find((row) => row.month === month), month).toMatchObject({ fuelAmount: null, purchasingAmount: 0 })
    }
  })

  it("un cero certificado por la cobertura sigue siendo cero, y un mes con filas conserva su cifra", async () => {
    const data = await getAnalyticsDashboard(session(), TREND)

    expect(data.spendByMonth.find((row) => row.month === "2026-01")?.fuelAmount).toBe(0)
    expect(data.spendByMonth.find((row) => row.month === "2026-02")?.fuelAmount).toBe(200_000)
    // Marzo de la ventana (hasta el 25) sigue siendo la cifra de siempre.
    expect(data.spendByMonth.find((row) => row.month === "2026-03")?.fuelAmount).toBe(1_369_000)
  })

  it("un mes con cobertura incompleta pero con filas no se oculta", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-04-01", toDate: "2026-04-30" })

    expect(data.spendByMonth.at(-1)).toMatchObject({ month: "2026-04", fuelAmount: 80_000 })
  })

  it("con una faena filtrada, un mes con datos del proveedor para otra faena es un cero, no un hueco", async () => {
    const data = await getAnalyticsDashboard(session(), { ...TREND, worksiteId: IDS.wsB })

    expect(data.spendByMonth.find((row) => row.month === "2026-02")?.fuelAmount).toBe(0)
    expect(data.spendByMonth.find((row) => row.month === "2025-07")?.fuelAmount).toBeNull()
  })

  it("el total de un mes con hueco es sólo lo comprado: no incluye un combustible que no se conoce", async () => {
    const data = await getAnalyticsDashboard(session(), TREND)
    const gap = data.spendByMonth.find((row) => row.month === "2025-07")!

    expect(gap.totalAmount).toBe(gap.purchasingAmount)
  })

  it("sin combustibles:view_costs no se consulta la cobertura: la serie de combustible no existe y queda en cero", async () => {
    const data = await getAnalyticsDashboard(session({ permissions: ["analytics:view", "combustibles:view"] }), TREND)

    expect(data.spendByMonth.every((row) => row.fuelAmount === 0)).toBe(true)
  })

  it("los KPI del período no cambian: el hueco sólo afecta a la serie mensual", async () => {
    const data = await getAnalyticsDashboard(session(), { fromDate: "2026-03-01", toDate: "2026-03-31" })

    expect(data.kpis.fuelAmount).toBe(1_374_000)
  })
})
