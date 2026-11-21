import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { inArray } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, globalSession, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Consumo (`fuel_consumption_records`) con uso personal, cuando Copec trae el detalle:
 * el dueño carga con la tarjeta de Chome, así que sus cargas son transacciones con
 * día y patente, y el registro mensual descuenta exactamente esas, como Control
 * operacional. Sin detalle de esa cuenta (o con una fuente que no es Copec TCT) no
 * hay con qué cruzar y se prorratea por días.
 *
 * Todos los equipos estuvieron en uso personal del 10 al 19 de octubre.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { consumptionKeptAmountSql, consumptionKeptQuantitySql, getConsumptionDashboard, loadConsumptionKept } = await import("@/lib/combustibles/consumption-dashboard")
const { getFuelControlOverview } = await import("@/lib/combustibles/fuel-control-overview")

const FROM = "2026-10-01"
const TO = "2026-10-31"

function costSession() {
  const base = globalSession()
  return { ...base, user: { ...base.user, permissions: ["combustibles:view", "combustibles:view_costs"] } } as ReturnType<typeof globalSession>
}

const PLATES: Record<string, string> = { [IDS.vA]: "AA-0001", [IDS.vB]: "BB-0002", [IDS.vC]: "CC-0003" }

let seq = 0
async function addTx(input: {
  vehicle: string; account: "tct:diesel" | "tct:bluemax"; occurredAt: string; amount: number
  status?: "accepted" | "pending" | "superseded"; granularity?: "transaction" | "period_aggregate"
}) {
  seq += 1
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: `ce-tx-${seq}`, syncRunId: "ce-run", provider: "copec", sourceAccount: input.account,
    identityKey: `ce-idk-${seq}`, fingerprint: `ce-fp-${seq}`, sourceRowKey: `ce-row-${seq}`, payloadHash: `ce-ph-${seq}`,
    worksiteId: IDS.wsA, vehicleId: input.vehicle, sourcePlate: PLATES[input.vehicle], occurredAt: input.occurredAt,
    quantity: input.amount / 1000, amount: input.amount, status: input.status ?? "accepted",
    granularity: input.granularity ?? "transaction",
  })
}

async function addRecord(id: string, input: { vehicleId: string; worksiteId: string; patente: string; fuente: string; monto: number }) {
  await testDb.insert(schema.fuelConsumptionRecords).values({
    id, batchId: "ce-batch", worksiteId: input.worksiteId, vehicleId: input.vehicleId, patente: input.patente,
    numeroTransacciones: 4, cantidadUnidad: input.monto / 1000, monto: input.monto, periodoDesde: FROM, periodoHasta: TO, fuente: input.fuente,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "ce-run", provider: "copec", requestedFrom: FROM, requestedTo: TO, correlationId: "corr-ce",
  })
  await testDb.insert(schema.fuelImportBatches).values({
    id: "ce-batch", worksiteId: IDS.wsA, fuente: "Copec TCT Diesel", periodoDesde: FROM, periodoHasta: TO,
    archivoNombre: "ce.xlsx", hashArchivo: "ce-hash", importadoPor: IDS.user,
  })
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([IDS.vA, IDS.vB, IDS.vC].map((vehicleId, i) => ({
    id: `ce-pu-${i}`, vehicleId, startedOn: "2026-10-10", endedOn: "2026-10-19",
  })))

  // vA, Diesel: el registro del mes y su detalle. Personales: la del 12 y la de las 22:30 del 19
  // en Chile (01:30 UTC del 20). La pendiente del 15 y la reemplazada del 13 no son cargas aceptadas.
  await addRecord("ce-a-diesel", { vehicleId: IDS.vA, worksiteId: IDS.wsA, patente: "AA-0001", fuente: "Copec TCT Diesel", monto: 310_000 })
  await addTx({ vehicle: IDS.vA, account: "tct:diesel", occurredAt: "2026-10-05T14:00:00.000Z", amount: 100_000 })
  await addTx({ vehicle: IDS.vA, account: "tct:diesel", occurredAt: "2026-10-12T14:00:00.000Z", amount: 200_000 })
  await addTx({ vehicle: IDS.vA, account: "tct:diesel", occurredAt: "2026-10-20T01:30:00.000Z", amount: 7_000 })
  await addTx({ vehicle: IDS.vA, account: "tct:diesel", occurredAt: "2026-10-15T14:00:00.000Z", amount: 50_000, status: "pending" })
  await addTx({ vehicle: IDS.vA, account: "tct:diesel", occurredAt: "2026-10-13T14:00:00.000Z", amount: 40_000, status: "superseded" })
  await addTx({ vehicle: IDS.vA, account: "tct:diesel", occurredAt: "2026-10-25T14:00:00.000Z", amount: 3_000 })

  // vA, BlueMax: su propio registro y su propio detalle; el Diesel personal no lo toca.
  await addRecord("ce-a-bluemax", { vehicleId: IDS.vA, worksiteId: IDS.wsA, patente: "AA-0001", fuente: "Copec TCT BlueMax", monto: 20_000 })
  await addTx({ vehicle: IDS.vA, account: "tct:bluemax", occurredAt: "2026-10-14T14:00:00.000Z", amount: 5_000 })
  await addTx({ vehicle: IDS.vA, account: "tct:bluemax", occurredAt: "2026-10-28T14:00:00.000Z", amount: 15_000 })

  // vB, Diesel: sólo el agregado mensual, sin detalle → se prorratea (21 de 31 días).
  await addRecord("ce-b-diesel", { vehicleId: IDS.vB, worksiteId: IDS.wsB, patente: "BB-0002", fuente: "Copec TCT Diesel", monto: 310_000 })
  await addTx({ vehicle: IDS.vB, account: "tct:diesel", occurredAt: "2026-10-01", amount: 310_000, granularity: "period_aggregate" })

  // vB, BlueMax: con detalle, y lo personal supera al registro → queda en 0, no negativo.
  await addRecord("ce-b-bluemax", { vehicleId: IDS.vB, worksiteId: IDS.wsB, patente: "BB-0002", fuente: "Copec TCT BlueMax", monto: 10_000 })
  await addTx({ vehicle: IDS.vB, account: "tct:bluemax", occurredAt: "2026-10-11T14:00:00.000Z", amount: 30_000 })

  // vC: un registro que no es de Copec TCT no se cruza con el detalle de Copec → se prorratea.
  await addRecord("ce-c-other", { vehicleId: IDS.vC, worksiteId: IDS.wsC, patente: "CC-0003", fuente: "Aramco Fleet Diesel", monto: 310_000 })
  await addTx({ vehicle: IDS.vC, account: "tct:diesel", occurredAt: "2026-10-12T14:00:00.000Z", amount: 100_000 })
}, 60_000)

async function kept() {
  const R = schema.fuelConsumptionRecords
  const k = await loadConsumptionKept()
  const rows = await testDb.select({ id: R.id, amount: consumptionKeptAmountSql(k), quantity: consumptionKeptQuantitySql(k) })
    .from(R).where(inArray(R.id, ["ce-a-diesel", "ce-a-bluemax", "ce-b-diesel", "ce-b-bluemax", "ce-c-other"]))
  return new Map(rows.map((r) => [r.id, { amount: Number(r.amount), quantity: Number(r.quantity) }]))
}

describe("Consumo con detalle de Copec", () => {
  it("descuenta exactamente las cargas aceptadas en días de uso personal, por cuenta", async () => {
    const byId = await kept()
    expect(byId.get("ce-a-diesel")!.amount).toBeCloseTo(103_000, 4) // 310.000 − 200.000 − 7.000
    expect(byId.get("ce-a-diesel")!.quantity).toBeCloseTo(103, 6)
    expect(byId.get("ce-a-bluemax")!.amount).toBeCloseTo(15_000, 4) // 20.000 − 5.000
    expect(byId.get("ce-b-bluemax")!.amount).toBe(0)
  })

  it("sin detalle de esa cuenta, o con otra fuente, prorratea por días", async () => {
    const byId = await kept()
    expect(byId.get("ce-b-diesel")!.amount).toBeCloseTo(210_000, 4) // 310.000 × 21/31
    expect(byId.get("ce-c-other")!.amount).toBeCloseTo(210_000, 4)
  })

  it("las sumas del tablero no llevan subconsultas: el cálculo exacto corre aparte, sobre los registros con uso personal", async () => {
    // Una subconsulta por registro dentro de un agregado hace que Postgres estime el
    // plan por encima del umbral del JIT: más de 1 s por consulta aunque nadie
    // tenga uso personal (medido en el clon de producción, 2026-11-20).
    const k = await loadConsumptionKept()
    expect(k.map((row) => row.id).sort()).toEqual(["ce-a-bluemax", "ce-a-diesel", "ce-b-bluemax", "ce-b-diesel", "ce-c-other"])
    const rendered = new PgDialect().sqlToQuery(consumptionKeptAmountSql(k)).sql
    expect(rendered).not.toMatch(/\bselect\b/i)
    expect(new PgDialect().sqlToQuery(consumptionKeptQuantitySql([])).sql).toBe('"fuel_consumption_records"."cantidad_unidad"')
  })

  it("el tablero de Consumo y el resumen de Control operacional usan la misma cifra", async () => {
    const data = await getConsumptionDashboard(costSession(), { fromDate: FROM, toDate: TO })
    expect(data.kpis.totalMonto).toBeCloseTo(103_000 + 15_000 + 210_000 + 0 + 210_000, 4)
    expect(data.topPatentesPorGasto.find((row) => row.patente === "AA-0001")!.monto).toBeCloseTo(118_000, 4)
    const overview = await getFuelControlOverview(costSession(), { includeTae: false, filters: { fromDate: FROM, toDate: TO } })
    expect(overview.byWorksite.find((row) => row.worksiteId === IDS.wsA)!.tctLiters).toBeCloseTo(118, 6)
  })
})
