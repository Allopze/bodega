import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, count, gte, lt, ne, or, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { reportWindows } from "@/app/(app)/reportes/reportes-period"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { getOperationalPeriodMetrics } = await import("@/lib/services/operational-period-metrics")
const { getOperationalTrendHistory } = await import("@/lib/services/operational-trend-history")

/**
 * P-8 (AUDITORIA_VISUALIZACIONES_CHOME.md, K.5): el conteo de recepciones del tablero incluía las
 * ANULADAS (`status = 'voided'`) y `/reportes` («Recepciones registradas») no. El mismo rótulo daba una
 * cifra distinta según la pantalla.
 *
 * Esta suite es la prueba de aceptación: para el mismo período y la misma faena, el tile del Resumen
 * (`getOperationalPeriodMetrics`), la serie mensual de tendencia (`getOperationalTrendHistory`) y la
 * consulta de `/reportes` dan el MISMO número, y las anuladas no suman en ninguno. El fixture mete
 * anuladas en el período actual, en el anterior y en la faena ajena, de modo que la base vieja (que las
 * contaba) discrepa en las tres.
 */

const WS_A = "ws-rv-a"
const WS_B = "ws-rv-b"
const USER = "u-rv"
const NOW = new Date("2026-10-15T15:00:00Z")

type ReceiptSeed = { id: string; order: string; at: string; voided?: boolean }

const ORDERS = [{ id: "oc-rv-a", ws: WS_A }, { id: "oc-rv-b", ws: WS_B }]

const RECEIPTS: ReceiptSeed[] = [
  // Faena A, octubre (período actual): 3 vigentes y 1 anulada.
  { id: "r-a-oct-1", order: "oc-rv-a", at: "2026-10-03T12:00:00.000Z" },
  { id: "r-a-oct-2", order: "oc-rv-a", at: "2026-10-09T12:00:00.000Z" },
  { id: "r-a-oct-3", order: "oc-rv-a", at: "2026-10-14T12:00:00.000Z" },
  { id: "r-a-oct-void", order: "oc-rv-a", at: "2026-10-10T12:00:00.000Z", voided: true },
  // Faena A, septiembre (período anterior): 2 vigentes y 2 anuladas.
  { id: "r-a-sep-1", order: "oc-rv-a", at: "2026-09-04T12:00:00.000Z" },
  { id: "r-a-sep-2", order: "oc-rv-a", at: "2026-09-21T12:00:00.000Z" },
  { id: "r-a-sep-void-1", order: "oc-rv-a", at: "2026-09-12T12:00:00.000Z", voided: true },
  { id: "r-a-sep-void-2", order: "oc-rv-a", at: "2026-09-13T12:00:00.000Z", voided: true },
  // Faena A, agosto: sólo una anulada (historia: sin ella no habría antecedentes vigentes anteriores).
  { id: "r-a-aug-void", order: "oc-rv-a", at: "2026-08-12T12:00:00.000Z", voided: true },
  // Faena B, octubre: 2 vigentes y 1 anulada; septiembre: 1 vigente.
  { id: "r-b-oct-1", order: "oc-rv-b", at: "2026-10-05T12:00:00.000Z" },
  { id: "r-b-oct-2", order: "oc-rv-b", at: "2026-10-06T12:00:00.000Z" },
  { id: "r-b-oct-void", order: "oc-rv-b", at: "2026-10-07T12:00:00.000Z", voided: true },
  { id: "r-b-sep-1", order: "oc-rv-b", at: "2026-09-08T12:00:00.000Z" },
]

function session(overrides: { worksiteIds?: string[]; isGlobal?: boolean } = {}): Session {
  return {
    user: {
      id: USER, isActive: true, roles: [], isGlobal: overrides.isGlobal ?? true,
      worksiteIds: overrides.worksiteIds ?? [], permissions: [],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

/**
 * La consulta de `/reportes` («Recepciones registradas»), tal como la arma `app/(app)/reportes/page.tsx`:
 * sin anuladas, con el alcance sobre `receipts.worksite_id`, sobre las ventanas de `reportWindows`
 * (las mismas del tablero) y con el conteo de cada ventana por separado.
 */
async function reportesFigure(scope: string[] | "all", worksiteId?: string) {
  const { current, previous } = reportWindows("mes", NOW)
  const inWindow = (window: { start: string; end: string }) => and(gte(schema.receipts.receivedAt, window.start), lt(schema.receipts.receivedAt, window.end))
  const countWhere = (condition: ReturnType<typeof inWindow>) => sql<number>`count(*) filter (where ${condition})`
  const [row] = await db
    .select({ total: countWhere(inWindow(current!)), previous: countWhere(inWindow(previous!)) })
    .from(schema.receipts)
    .where(and(
      ne(schema.receipts.status, "voided"),
      worksiteScopeSqlFor(scope, schema.receipts.worksiteId, worksiteId),
      or(inWindow(current!), inWindow(previous!)),
    ))
  return { current: Number(row?.total ?? 0), previous: Number(row?.previous ?? 0) }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await pg.exec("SET TIME ZONE 'UTC'")
  await db.insert(schema.worksites).values([
    { id: WS_A, code: "RV-A", name: "Faena A" },
    { id: WS_B, code: "RV-B", name: "Faena B" },
  ])
  await db.insert(schema.users).values({ id: USER, name: "QA", email: "rv@test.local", hashedPassword: "hash" })
  await db.insert(schema.suppliers).values({ id: "s-rv", name: "Proveedor RV" })
  await db.insert(schema.purchaseOrders).values(ORDERS.map((order) => ({
    id: order.id, code: order.id.toUpperCase(), worksiteId: order.ws, supplierId: "s-rv", createdBy: USER, status: "received",
    issuedAt: "2026-08-01T12:00:00.000Z", netAmount: 100, taxAmount: 19, totalAmount: 119,
  })))
  await db.insert(schema.receipts).values(RECEIPTS.map((receipt, index) => {
    const order = ORDERS.find((candidate) => candidate.id === receipt.order)!
    return {
      id: receipt.id, code: `REC-RV-${index}`, purchaseOrderId: receipt.order, receivedBy: USER, receivedAt: receipt.at, worksiteId: order.ws,
      ...(receipt.voided
        ? { status: "voided", voidedAt: receipt.at, voidedBy: USER, voidReason: "Recepción equivocada, se anula" }
        : {}),
    }
  }))
}, 60_000)

afterAll(async () => { await pg.close() })

describe("P-8 · el conteo de recepciones del tablero no incluye las anuladas", () => {
  it("el fixture es sensible: contando también las anuladas el período daría otra cifra", async () => {
    const { current } = reportWindows("mes", NOW)
    const [row] = await db.select({ value: count() }).from(schema.receipts)
      .where(and(gte(schema.receipts.receivedAt, current!.start), lt(schema.receipts.receivedAt, current!.end)))

    // 5 vigentes (3 + 2) y 2 anuladas en octubre: sin el filtro el tablero diría 7.
    expect(Number(row?.value)).toBe(7)
  })

  it("rol global: el tile del Resumen, la serie mensual y /reportes dan el mismo número, también el del período anterior", async () => {
    const metrics = await getOperationalPeriodMetrics(session(), { period: "mes", now: NOW })
    const reportes = await reportesFigure("all")
    const trend = await getOperationalTrendHistory(session(), 2, NOW)

    expect(metrics.receipts.current).toBe(5)
    expect(metrics.receipts.current).toBe(reportes.current)
    expect(metrics.receipts.previous).toBe(3)
    expect(metrics.receipts.previous).toBe(reportes.previous)
    // La serie mensual: septiembre y octubre, los mismos dos períodos.
    expect(trend.map((point) => point.receipts)).toEqual([reportes.previous, reportes.current])
  })

  it("con una faena del alcance elegida, las tres fuentes siguen coincidiendo", async () => {
    const metrics = await getOperationalPeriodMetrics(session(), { period: "mes", now: NOW, worksiteId: WS_A })
    const reportes = await reportesFigure("all", WS_A)
    const trend = await getOperationalTrendHistory(session(), 2, NOW, WS_A)

    expect(metrics.receipts).toEqual({ current: 3, previous: 2 })
    expect({ current: metrics.receipts.current, previous: metrics.receipts.previous }).toEqual(reportes)
    expect(trend.map((point) => point.receipts)).toEqual([reportes.previous, reportes.current])
  })

  it("un usuario acotado a la faena B ve lo suyo, sin anuladas, y coincide con /reportes", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: [WS_B] })
    const metrics = await getOperationalPeriodMetrics(scoped, { period: "mes", now: NOW })
    const reportes = await reportesFigure([WS_B])

    expect(metrics.receipts).toEqual({ current: 2, previous: 1 })
    expect({ current: metrics.receipts.current, previous: metrics.receipts.previous }).toEqual(reportes)
  })

  it("elegir la faena ajena no amplía el alcance (cero, no «todas»)", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: [WS_A] })
    const metrics = await getOperationalPeriodMetrics(scoped, { period: "mes", now: NOW, worksiteId: WS_B })
    const reportes = await reportesFigure([WS_A], WS_B)

    expect(metrics.receipts.current).toBe(0)
    expect(reportes.current).toBe(0)
  })

  it("un mes con sólo recepciones anuladas cuenta cero, y sin antecedentes vigentes no se inventa una comparación", async () => {
    // Agosto tiene sólo una anulada: sin la corrección el tablero diría 1 recepción en agosto.
    const metrics = await getOperationalPeriodMetrics(session(), { period: "mes", now: new Date("2026-08-20T15:00:00Z"), worksiteId: WS_A })

    expect(metrics.receipts.current).toBe(0)
    // Antes de julio no hay recepciones vigentes: sin antecedentes no se inventa un «0 el mes anterior».
    expect(metrics.receipts.previous).toBeNull()
  })
})
