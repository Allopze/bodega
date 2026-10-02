/**
 * lib/__tests__/operational-metric-snapshots-capture.test.ts
 *
 * Cubre `captureOperationalMetricSnapshots`, el cron diario que alimenta
 * "Backlog comparado" y sus sparklines.
 *
 * El contrato que importa es la **cobertura completa**: escribe una fila por
 * cada (métrica × faena activa), con `"0"` explícito cuando la faena no aparece
 * en el `GROUP BY`. `getOperationalSnapshotHistory` descarta los días que no
 * tienen todas las faenas, así que si la captura omitiera una faena la serie se
 * acortaría en silencio en vez de fallar.
 *
 * Mismo truco de mock que `dashboard-service.test.ts`: las cadenas de drizzle son
 * thenables. Aquí además se mockea `db.insert`, que ese harness no cubre.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

let selectCallCount = 0
const selectResults: Array<{ data: unknown }> = []
/** Filas que llegaron a `insert().values(...)`, para inspeccionarlas. */
let insertedRows: Array<Record<string, unknown>> = []
let insertCallCount = 0

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  for (const method of ["from", "where", "groupBy", "orderBy", "limit", "innerJoin", "leftJoin"]) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    select: () => createChain((selectResults[selectCallCount++]?.data as unknown[]) ?? []),
    insert: () => {
      insertCallCount++
      const chain: Record<string, unknown> = {}
      chain.values = vi.fn((rows: Array<Record<string, unknown>>) => {
        insertedRows = rows
        return chain
      })
      chain.onConflictDoUpdate = vi.fn(() => chain)
      chain.then = (resolve: (v: unknown) => void) => Promise.resolve(undefined).then(resolve)
      return chain
    },
  },
}))

vi.mock("@/lib/id", () => ({ nanoid: () => "id-fijo" }))

import { captureOperationalMetricSnapshots } from "@/lib/services/operational-metric-snapshots"

/** Orden de los `db.select()` dentro de la función, que es posicional. */
function queueSelects(input: {
  worksites: string[]
  requests?: Array<{ worksiteId: string; value: number }>
  orders?: Array<{ worksiteId: string; value: number }>
  capa?: Array<{ worksiteId: string; value: number }>
  obligations?: Array<{ worksiteId: string; value: number }>
}) {
  selectResults.push({ data: input.worksites.map((id) => ({ id })) })
  selectResults.push({ data: input.requests ?? [] })
  selectResults.push({ data: input.orders ?? [] })
  selectResults.push({ data: input.capa ?? [] })
  selectResults.push({ data: input.obligations ?? [] })
}

const rowsFor = (metric: string) => insertedRows.filter((row) => row.metric === metric)

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  insertedRows = []
  insertCallCount = 0
})

describe("captureOperationalMetricSnapshots", () => {
  it("writes one row per metric and active worksite", async () => {
    queueSelects({ worksites: ["ws-1", "ws-2"] })

    const result = await captureOperationalMetricSnapshots(new Date("2026-07-30T15:00:00Z"))

    // 4 métricas × 2 faenas. `stock_alerts` se retiró con el stock mínimo.
    expect(result.written).toBe(8)
    expect(insertedRows).toHaveLength(8)
    expect(new Set(insertedRows.map((row) => row.metric))).toEqual(new Set([
      "backlog_requests", "backlog_orders", "backlog_capa", "backlog_pdtp",
    ]))
  })

  it("writes an explicit 0 for worksites absent from the GROUP BY", async () => {
    queueSelects({
      worksites: ["ws-1", "ws-2"],
      // ws-2 no tiene solicitudes activas.
      requests: [{ worksiteId: "ws-1", value: 5 }],
    })

    await captureOperationalMetricSnapshots(new Date("2026-07-30T15:00:00Z"))

    expect(rowsFor("backlog_requests").map((row) => [row.worksiteId, row.value])).toEqual([
      ["ws-1", "5"],
      ["ws-2", "0"],
    ])
  })

  it("resolves the snapshot date in Chile time", async () => {
    queueSelects({ worksites: ["ws-1"] })

    // 2027-01-01T02:00Z son las 23:00 del 31-dic en Chile (UTC-3 en verano).
    const result = await captureOperationalMetricSnapshots(new Date("2027-01-01T02:00:00Z"))

    expect(result.snapshotDate).toBe("2026-12-31")
    expect(insertedRows.every((row) => row.snapshotDate === "2026-12-31")).toBe(true)
  })

  it("does not touch the table when there is no active worksite", async () => {
    queueSelects({ worksites: [] })

    const result = await captureOperationalMetricSnapshots(new Date("2026-07-30T15:00:00Z"))

    expect(result.written).toBe(0)
    expect(insertCallCount).toBe(0)
  })
})
