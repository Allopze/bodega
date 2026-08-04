/**
 * `getOperationalSnapshotHealth` existe porque el par captura/lectura falla en
 * **silencio**: la captura escribe una fila por métrica × faena activa y la
 * lectura descarta los días sin cobertura completa, así que un cron detenido
 * sólo hace que las series se acorten — indistinguible de "aún no hay historia".
 *
 * Estos casos fijan la aritmética de cobertura, que es lo único que puede
 * distinguir un cron sano de uno roto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

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
  db: { select: () => createChain((selectResults[selectCallCount++]?.data as unknown[]) ?? []) },
}))

vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: vi.fn() }))

import { getOperationalSnapshotHealth } from "@/lib/services/operational-metric-snapshots"

/** 5 métricas × N faenas es lo que debe tener un día completo. */
const METRICS = 5
const NOW = new Date("2026-07-31T15:00:00.000Z")

/** Primero se consultan las faenas activas, después las filas por día. */
function mockDb(worksites: number, days: Array<{ snapshotDate: string; rows: number }>) {
  selectResults.push({ data: Array.from({ length: worksites }, (_, i) => ({ id: `ws-${i}` })) })
  selectResults.push({ data: days })
}

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
})

describe("getOperationalSnapshotHealth", () => {
  it("declara sano un día completo y reciente", async () => {
    mockDb(3, [
      { snapshotDate: "2026-07-31", rows: 3 * METRICS },
      { snapshotDate: "2026-07-30", rows: 3 * METRICS },
    ])

    const health = await getOperationalSnapshotHealth(NOW)

    expect(health.expectedRowsPerDay).toBe(15)
    expect(health.lastDayComplete).toBe(true)
    expect(health.ageDays).toBe(0)
    expect(health.completeDaysLast30).toBe(2)
  })

  /*
   * El caso que motiva todo esto: el cron corrió pero le faltó una faena —por
   * ejemplo porque se activó una nueva—. La lectura descarta ese día entero, así
   * que la serie pierde un punto sin avisar.
   */
  it("detecta la cobertura incompleta que la lectura descarta en silencio", async () => {
    mockDb(4, [{ snapshotDate: "2026-07-31", rows: 3 * METRICS }])

    const health = await getOperationalSnapshotHealth(NOW)

    expect(health.expectedRowsPerDay).toBe(20)
    expect(health.lastDayRows).toBe(15)
    expect(health.lastDayComplete).toBe(false)
    expect(health.completeDaysLast30).toBe(0)
  })

  it("mide la antigüedad del último corte en días de calendario chileno", async () => {
    mockDb(2, [{ snapshotDate: "2026-07-28", rows: 2 * METRICS }])

    const health = await getOperationalSnapshotHealth(NOW)

    expect(health.lastSnapshotDate).toBe("2026-07-28")
    expect(health.ageDays).toBe(3)
  })

  it("sin ninguna instantánea no inventa una edad", async () => {
    mockDb(2, [])

    const health = await getOperationalSnapshotHealth(NOW)

    expect(health.lastSnapshotDate).toBeNull()
    expect(health.ageDays).toBeNull()
    expect(health.lastDayComplete).toBe(false)
  })

  // Sin faenas activas la captura no tiene nada que escribir: cero filas es lo
  // correcto, no una falla. Sin este caso el chequeo alertaría en un entorno nuevo.
  it("sin faenas activas no reporta cobertura incompleta", async () => {
    mockDb(0, [])

    const health = await getOperationalSnapshotHealth(NOW)

    expect(health.activeWorksites).toBe(0)
    expect(health.expectedRowsPerDay).toBe(0)
    expect(health.completeDaysLast30).toBe(0)
  })

  it("cuenta sólo los días completos, no todos los que tienen filas", async () => {
    mockDb(2, [
      { snapshotDate: "2026-07-31", rows: 2 * METRICS },
      { snapshotDate: "2026-07-30", rows: 2 * METRICS - 1 },
      { snapshotDate: "2026-07-29", rows: 2 * METRICS },
    ])

    const health = await getOperationalSnapshotHealth(NOW)

    expect(health.completeDaysLast30).toBe(2)
  })
})
