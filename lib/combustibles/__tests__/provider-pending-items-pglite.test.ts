import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { describeProviderPendingItems, listProviderPendingItems } = await import("../provider-pending-items")

let seq = 0

async function ledgerRow(input: { runId?: string; account: string; plate: string | null; occurredAt: string; liters: number; status?: "pending" | "accepted"; code?: string }) {
  seq++
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: `tx-${seq}`, syncRunId: input.runId ?? "run-ene", provider: "copec", sourceAccount: input.account,
    identityKey: `id-${seq}`, fingerprint: `fp-${seq}`, sourceRowKey: `row-${seq}`, sourcePlate: input.plate,
    occurredAt: input.occurredAt, quantity: input.liters, amount: input.liters * 950,
    status: input.status ?? "pending", resolutionCode: input.code ?? "unresolved_mapping", payloadHash: `hash-${seq}`,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.fuelProviderSyncRuns).values([
    { id: "run-ene", provider: "copec", requestedFrom: "2026-01-01", requestedTo: "2026-01-31", correlationId: "corr-ene" },
    { id: "run-oct", provider: "copec", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", correlationId: "corr-oct" },
  ])
  // La tarjeta TAE de Mininco como en prod el 2026-10-30: cada carga queda dos
  // veces en el ledger, como `unresolved_mapping` y como `unmapped_tae_card`.
  for (const [day, liters] of [["02", 600], ["09", 700], ["16", 650]] as const) {
    await ledgerRow({ account: "tae:diesel", plate: "1-242269-00258-9-8", occurredAt: `2026-01-${day}T12:00:00.000Z`, liters })
    await ledgerRow({ account: "tae:diesel", plate: "1-242269-00258-9-8", occurredAt: `2026-01-${day}T12:00:00.000Z`, liters, code: "unmapped_tae_card" })
  }
  // Una patente sin vehículo, con diésel y BlueMax: es una sola patente.
  await ledgerRow({ account: "tct:diesel", plate: "AB-CD12", occurredAt: "2026-01-05T10:00:00.000Z", liters: 40 })
  await ledgerRow({ account: "tct:bluemax", plate: "ABCD12", occurredAt: "2026-01-05T10:05:00.000Z", liters: 5 })
  // Fuera de la lista: una aceptada, otra corrida y una fila sin patente.
  await ledgerRow({ account: "tct:diesel", plate: "ZZZZ99", occurredAt: "2026-01-06T10:00:00.000Z", liters: 30, status: "accepted" })
  await ledgerRow({ runId: "run-oct", account: "tct:diesel", plate: "YYYY88", occurredAt: "2026-10-06T10:00:00.000Z", liters: 30 })
  await ledgerRow({ account: "tct:diesel", plate: null, occurredAt: "2026-01-07T10:00:00.000Z", liters: 30 })
}, 60_000)

describe("listProviderPendingItems", () => {
  it("nombra cada tarjeta y patente pendiente de la corrida, contando cada carga una vez", async () => {
    await expect(listProviderPendingItems("run-ene")).resolves.toEqual([
      { kind: "tae_card", label: "1-242269-00258-9-8", loads: 3 },
      { kind: "plate", label: "AB-CD12", loads: 2 },
    ])
  })

  it("una corrida sin pendientes no nombra nada", async () => {
    await expect(listProviderPendingItems("run-sin-filas")).resolves.toEqual([])
  })
})

describe("describeProviderPendingItems", () => {
  it("dice qué falta en cada caso, con la cantidad de cargas", () => {
    expect(describeProviderPendingItems([
      { kind: "tae_card", label: "1-242269-00258-9-8", loads: 8 },
      { kind: "plate", label: "AB-CD12", loads: 2 },
    ])).toBe("tarjeta de abastecimiento 1-242269-00258-9-8 (8 cargas, sin estanque activo) y patente AB-CD12 (2, sin vehículo o asignación)")
  })

  it("nombra tres y resume el resto", () => {
    const items = ["AAAA11", "BBBB22", "CCCC33", "DDDD44", "EEEE55"].map((label) => ({ kind: "plate" as const, label, loads: 1 }))
    expect(describeProviderPendingItems(items)).toBe("patente AAAA11 (1 carga, sin vehículo o asignación), patente BBBB22 (1, sin vehículo o asignación), patente CCCC33 (1, sin vehículo o asignación) y 2 más")
  })
})
