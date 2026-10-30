import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import type postgres from "postgres"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import {
  findBlockingFuelCounters,
  findFuelDebtCounters,
  readFuelIntegrationsPreflight,
  type FuelIntegrationsPreflight,
} from "@/scripts/preflight-fuel-integrations"

/**
 * La puerta del deploy contra el esquema real y con los casos que la tumbaron
 * en producción el 2026-10-30. La consulta no interpola nada, así que basta una
 * plantilla etiquetada contra PGlite (mismo shim que el preflight de
 * conciliación OC-factura).
 */
const pg = new PGlite()
const db = drizzle(pg, { schema })
const sqlShim = {
  begin: (_mode: string, fn: (tx: unknown) => unknown) =>
    Promise.resolve(
      fn(Object.assign((strings: TemplateStringsArray, ...fragments: string[]) => pg.query(strings.reduce((text, part, index) => text + part + (fragments[index] ?? ""), "")).then((result) => result.rows), { unsafe: (fragment: string) => fragment })),
    ),
} as unknown as postgres.Sql

const now = "2026-10-30T12:00:00.000Z"
let seq = 0

async function ledgerRow(plate: string, occurredAt: string, identityKey: string, status: "accepted" | "rejected", resolutionCode: string | null = null) {
  seq++
  await db.insert(schema.fuelProviderTransactions).values({
    id: `tx-${seq}`, syncRunId: "run-preflight", provider: "copec", sourceAccount: "tct:diesel",
    identityKey, fingerprint: `fp-${seq}`, sourceRowKey: identityKey.replace("row:copec:tct:diesel:", ""),
    sourcePlate: plate, occurredAt, quantity: 57.99, amount: 56361, status, resolutionCode, payloadHash: `hash-${seq}`,
  })
}

/** Un lote de una patente con una sola carga en el detalle, cuadrado con sus totales. */
async function batchWithLoad(worksiteId: string, period: [string, string], plate: string, guide: string) {
  seq++
  const batchId = `batch-${seq}`
  await db.insert(schema.fuelImportBatches).values({
    id: batchId, worksiteId, fuente: "Copec TCT Diesel", periodoDesde: period[0], periodoHasta: period[1],
    archivoNombre: "copec.xlsx", hashArchivo: `h-${seq}`, totalFilas: 1, filasValidas: 1, totalPatentes: 1,
    totalTransacciones: 1, totalCantidad: 68.44, totalMonto: 50000, importadoPor: "user-preflight",
  })
  await db.insert(schema.fuelConsumptionRecords).values({
    id: `record-${seq}`, batchId, worksiteId, patente: plate, numeroTransacciones: 1, cantidadUnidad: 68.44, monto: 50000,
    periodoDesde: period[0], periodoHasta: period[1], fuente: "Copec TCT Diesel",
    rawRow: { detalle: [{ Patente: plate, "Guía de Despacho": guide, "Fecha Transacción": period[0], "Hora Transacción": "11:33:00", "Odómetro (Kms.)": "100000" }] },
  })
}

let report: FuelIntegrationsPreflight

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.users).values({ id: "user-preflight", name: "Operador", email: "operador@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now })
  await db.insert(schema.worksites).values(["ws-a", "ws-b", "ws-masisa", "ws-masisa-2"].map((id) => ({ id, name: id, code: id.toUpperCase(), createdAt: now, updatedAt: now })))
  await db.insert(schema.fuelProviderSyncRuns).values({ id: "run-preflight", provider: "copec", requestedFrom: "2026-01-01", requestedTo: "2026-01-31", correlationId: "corr-preflight" })

  // TBZW-37, guía 660150998: la fila normal y la copia que el error de la guía
  // reutilizada dejó como «posible corrección». Es una segunda identidad por
  // diseño, no una identidad inestable.
  const tbzw = "row:copec:tct:diesel:2026-01:diesel:guide:2b0bfa56:sig:fae7ee40:1"
  await ledgerRow("TBZW-37", "2026-01-16T00:18:05.000Z", tbzw, "accepted")
  await ledgerRow("TBZW-37", "2026-01-16T00:18:05.000Z", `${tbzw}:correction-review`, "rejected", "possible_provider_correction")
  // Una identidad partida de verdad: la misma carga entró dos veces con claves distintas.
  await ledgerRow("SRCJ-39", "2026-02-01T10:00:00.000Z", "row:copec:tct:diesel:2026-02:diesel:guide:aaaa:sig:bbbb:1", "accepted")
  await ledgerRow("SRCJ-39", "2026-02-01T10:00:00.000Z", "row:copec:tct:diesel:2026-02:diesel:guide:cccc:sig:dddd:1", "accepted")

  // Copec repitió la guía 660150998 en dos vehículos: dos cargas, dos lecturas (0363).
  await batchWithLoad("ws-a", ["2026-01-01", "2026-01-31"], "SRCJ-47", "660150998")
  await batchWithLoad("ws-b", ["2026-01-01", "2026-01-31"], "TBZW-37", "660150998")
  // KTGZ-34 cambió de faena con octubre abierto: su carga quedó en los dos lotes
  // hasta que el cierre del mes vacíe el viejo.
  await batchWithLoad("ws-masisa", ["2026-10-01", "2026-10-31"], "KTGZ-34", "662800566")
  await batchWithLoad("ws-masisa-2", ["2026-10-01", "2026-10-31"], "KTGZ-34", "662800566")

  report = await readFuelIntegrationsPreflight(sqlShim)
})

describe("preflight de combustible contra el esquema real", () => {
  it("la copia «posible corrección» no cuenta como identidad partida; una partida real sí", () => {
    expect(report.splitTctIdentities).toBe(1)
  })

  it("una guía repetida en dos vehículos no es clave duplicada; la misma carga en dos lotes sí", () => {
    expect(report.detailDuplicateKeys).toBe(1)
  })

  it("la carga en dos lotes se informa como deuda y no detiene el deploy", () => {
    expect(findBlockingFuelCounters(report)).toEqual([{ counter: "splitTctIdentities", value: 1 }])
    expect(findFuelDebtCounters(report)).toContainEqual({ counter: "detailDuplicateKeys", value: 1 })
  })
})
