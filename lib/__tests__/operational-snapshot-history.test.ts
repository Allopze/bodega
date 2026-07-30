/**
 * lib/__tests__/operational-snapshot-history.test.ts
 *
 * Cubre `getOperationalSnapshotHistory`, la serie que alimenta los sparklines
 * del dashboard. Lo que se prueba es la **regla de cobertura**: un día sólo
 * cuenta si tiene instantánea de todas las faenas visibles. Sin ella la línea
 * caería los días en que faltó el snapshot de una faena, dibujando una mejora
 * que nunca ocurrió.
 *
 * Mismo truco de mock que `dashboard-service.test.ts`: las cadenas de drizzle
 * son thenables y cada `db.select()` devuelve una independiente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

let selectCallCount = 0
const selectResults: Array<{ data: unknown }> = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "groupBy", "limit"]) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    select: () => createChain((selectResults[selectCallCount++]?.data as unknown[]) ?? []),
  },
}))

vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: vi.fn() }))

import { getOperationalSnapshotHistory } from "@/lib/services/operational-metric-snapshots"
import { resolveWorksiteScope } from "@/lib/auth/scope"

const mockResolveScope = vi.mocked(resolveWorksiteScope)

const session = { user: { id: "u-1" }, expires: "" } as Session

/** Fila cruda como la devuelve la tabla: `value` es texto. */
const snap = (metric: string, worksiteId: string, snapshotDate: string, value: number) =>
  ({ metric, worksiteId, snapshotDate, value: String(value) })

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  mockResolveScope.mockReturnValue({ mode: "all" } as ReturnType<typeof resolveWorksiteScope>)
})

describe("getOperationalSnapshotHistory", () => {
  it("returns empty series for every metric when no worksite is visible", async () => {
    mockResolveScope.mockReturnValue({ mode: "none" } as ReturnType<typeof resolveWorksiteScope>)

    const history = await getOperationalSnapshotHistory(session)

    expect(history.backlog_requests).toEqual([])
    expect(history.stock_alerts).toEqual([])
  })

  it("sums every visible worksite per day, in chronological order", async () => {
    selectResults.push({ data: [{ id: "ws-1" }, { id: "ws-2" }] })
    selectResults.push({ data: [
      // Desordenadas a propósito: la función debe ordenar por fecha.
      snap("backlog_requests", "ws-1", "2026-07-29", 4),
      snap("backlog_requests", "ws-2", "2026-07-29", 6),
      snap("backlog_requests", "ws-1", "2026-07-28", 2),
      snap("backlog_requests", "ws-2", "2026-07-28", 3),
    ]})

    const history = await getOperationalSnapshotHistory(session)

    expect(history.backlog_requests).toEqual([5, 10])
  })

  it("drops days that lack a snapshot for some visible worksite", async () => {
    selectResults.push({ data: [{ id: "ws-1" }, { id: "ws-2" }] })
    selectResults.push({ data: [
      snap("backlog_capa", "ws-1", "2026-07-27", 1),
      snap("backlog_capa", "ws-2", "2026-07-27", 1),
      // 28-07 sólo tiene ws-1: incluirlo dibujaría una caída inexistente.
      snap("backlog_capa", "ws-1", "2026-07-28", 1),
      snap("backlog_capa", "ws-1", "2026-07-29", 3),
      snap("backlog_capa", "ws-2", "2026-07-29", 3),
    ]})

    const history = await getOperationalSnapshotHistory(session)

    expect(history.backlog_capa).toEqual([2, 6])
  })

  it("keeps each metric on its own series", async () => {
    selectResults.push({ data: [{ id: "ws-1" }] })
    selectResults.push({ data: [
      snap("backlog_orders", "ws-1", "2026-07-28", 7),
      snap("stock_alerts", "ws-1", "2026-07-28", 2),
      snap("stock_alerts", "ws-1", "2026-07-29", 5),
    ]})

    const history = await getOperationalSnapshotHistory(session)

    expect(history.backlog_orders).toEqual([7])
    expect(history.stock_alerts).toEqual([2, 5])
    expect(history.backlog_pdtp).toEqual([])
  })
})
