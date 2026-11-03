/**
 * The CAPA list quick filters are part of the server query, not a visual-only
 * client filter: totals and pagination must describe the same bounded dataset.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "capa-list-user",
    name: "Responsable CAPA",
    email: "capa-list@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-capa-list", name: "Faena CAPA", code: "CAPA-LIST", isActive: true },
    { id: "ws-capa-outside", name: "Faena fuera de alcance", code: "CAPA-OUT", isActive: true },
  ])

  await inMemoryDb.insert(schema.preventionCapaActions).values([
    capa("open", { createdAt: "2026-08-01T08:00:00.000Z" }),
    capa("overdue-stop", {
      createdAt: "2026-08-02T08:00:00.000Z",
      status: "in_progress",
      targetDate: "2020-01-01",
      reconciliationStatus: "needs_assignment",
      requiresImmediateStop: true,
    }),
    capa("pending-verification", {
      createdAt: "2026-08-03T08:00:00.000Z",
      status: "pending_verification",
    }),
    capa("closed-stop", {
      createdAt: "2026-08-04T08:00:00.000Z",
      status: "closed",
      requiresImmediateStop: true,
    }),
    capa("verified", {
      createdAt: "2026-08-05T08:00:00.000Z",
      status: "verified",
      targetDate: "2020-01-01",
    }),
    capa("outside", {
      createdAt: "2026-08-06T08:00:00.000Z",
      worksiteId: "ws-capa-outside",
      requiresImmediateStop: true,
    }),
  ])
})

const VIEWER = {
  scope: { mode: "some", ids: ["ws-capa-list"] } as WorksiteScope,
  permissions: ["prevention:capa:view"],
}

function capa(id: string, overrides: Partial<typeof schema.preventionCapaActions.$inferInsert> = {}) {
  const createdAt = overrides.createdAt ?? "2026-08-01T08:00:00.000Z"
  return {
    id: `capa-list-${id}`,
    code: `CAPA-LIST-${id}`,
    sourceType: "manual" as const,
    sourceId: `source-${id}`,
    worksiteId: "ws-capa-list",
    finding: `Hallazgo ${id}`,
    actionDescription: `Acción correctiva ${id}`,
    targetDate: "2099-12-31",
    createdByUserId: "capa-list-user",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

describe("CAPA list quick filters — persistence", () => {
  it("filters and counts the scoped server result before applying pagination", async () => {
    const { getCapaDashboardCounts, listCapaActionsPage } = await import("@/lib/services/prevention-capa")

    const [open, overdue, pendingVerification, unreconciled, immediateStop, counts] = await Promise.all([
      listCapaActionsPage({ ...VIEWER, quickFilter: "open", limit: 2, offset: 1 }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "overdue" }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "pending_verification" }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "unreconciled" }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "immediate_stop" }),
      getCapaDashboardCounts(VIEWER),
    ])

    expect(open).toMatchObject({ total: 4, limit: 2, offset: 1 })
    expect(open.rows.map((row) => row.id)).toEqual([
      "capa-list-pending-verification", "capa-list-overdue-stop",
    ])
    expect(overdue.rows.map((row) => row.id)).toEqual(["capa-list-overdue-stop"])
    expect(pendingVerification.rows.map((row) => row.id)).toEqual(["capa-list-pending-verification"])
    expect(unreconciled.rows.map((row) => row.id)).toEqual(["capa-list-overdue-stop"])
    expect(immediateStop.rows.map((row) => row.id)).toEqual(["capa-list-overdue-stop"])
    expect(counts).toEqual({
      open: 4,
      overdue: 1,
      pendingVerification: 1,
      unreconciled: 1,
      immediateStop: 1,
    })
  })
})

/**
 * Fase 0.7 (AUDITORIA_VISUALIZACIONES_CHOME): las tarjetas de /prevencion/capa
 * contaban todo el alcance del usuario aunque la lista de abajo estuviera
 * filtrada por faena, fuente o estado. Invariante que se fija: el número de una
 * tarjeta es exactamente lo que la lista devuelve al activarla (`vista=`) con los
 * mismos filtros, así que no pueden separarse.
 */
describe("CAPA tarjetas — responden a los mismos filtros que la lista", () => {
  const BOTH_WORKSITES = {
    scope: { mode: "some", ids: ["ws-capa-list", "ws-capa-outside"] } as WorksiteScope,
    permissions: ["prevention:capa:view"],
  }
  const TILE_BY_QUICK_FILTER = {
    open: "open",
    overdue: "overdue",
    pending_verification: "pendingVerification",
    unreconciled: "unreconciled",
    immediate_stop: "immediateStop",
  } as const

  beforeEach(async () => {
    await inMemoryDb.insert(schema.preventionCapaActions).values([
      // Otra fuente, en la faena del visor.
      capa("inspection-open", { createdAt: "2026-08-07T08:00:00.000Z", sourceType: "inspection" }),
      // Vencida y en proceso, en la otra faena.
      capa("ws2-overdue", {
        createdAt: "2026-08-08T08:00:00.000Z",
        worksiteId: "ws-capa-outside",
        status: "in_progress",
        targetDate: "2020-01-01",
      }),
    ])
  })

  async function tiles(filters: { worksiteId?: string; sourceType?: string; status?: string } = {}, base = BOTH_WORKSITES) {
    const { getCapaDashboardCounts, listCapaActionsPage } = await import("@/lib/services/prevention-capa")
    // `status` llega como texto de la URL; el tipo `CapaStatus` es sólo de compilación.
    const args = { ...base, ...filters } as Parameters<typeof getCapaDashboardCounts>[0]
    const counts = await getCapaDashboardCounts(args)
    const fromList: Record<string, number> = {}
    for (const quickFilter of Object.keys(TILE_BY_QUICK_FILTER) as Array<keyof typeof TILE_BY_QUICK_FILTER>) {
      const page = await listCapaActionsPage({ ...args, quickFilter, limit: 500 })
      fromList[TILE_BY_QUICK_FILTER[quickFilter]] = page.total
    }
    return { counts, fromList }
  }

  it("sin filtros cuenta todo el alcance, como antes", async () => {
    const { counts, fromList } = await tiles()

    expect(counts).toEqual({ open: 7, overdue: 2, pendingVerification: 1, unreconciled: 1, immediateStop: 2 })
    expect(counts).toEqual(fromList)
  })

  it("con una faena elegida cuenta sólo esa faena", async () => {
    const { counts, fromList } = await tiles({ worksiteId: "ws-capa-outside" })

    expect(counts).toEqual({ open: 2, overdue: 1, pendingVerification: 0, unreconciled: 0, immediateStop: 1 })
    expect(counts).toEqual(fromList)
  })

  it("con una fuente elegida cuenta sólo esa fuente", async () => {
    const { counts, fromList } = await tiles({ sourceType: "inspection" })

    expect(counts).toEqual({ open: 1, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 })
    expect(counts).toEqual(fromList)
  })

  it("con un estado elegido cuenta lo que la lista mostraría en ese estado", async () => {
    const { counts, fromList } = await tiles({ status: "in_progress" })

    expect(counts).toEqual({ open: 2, overdue: 2, pendingVerification: 0, unreconciled: 1, immediateStop: 1 })
    expect(counts).toEqual(fromList)
  })

  it("combina faena, fuente y estado igual que la lista", async () => {
    const { counts, fromList } = await tiles({ worksiteId: "ws-capa-list", sourceType: "manual", status: "pending_verification" })

    expect(counts).toEqual({ open: 1, overdue: 0, pendingVerification: 1, unreconciled: 0, immediateStop: 0 })
    expect(counts).toEqual(fromList)
  })

  it("una faena fuera del alcance no abre datos ajenos: tarjetas y lista en cero", async () => {
    // El visor sólo ve `ws-capa-list`; pedir la otra faena por URL no debe contarla.
    const { counts, fromList } = await tiles({ worksiteId: "ws-capa-outside" }, VIEWER)

    expect(counts).toEqual({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 })
    expect(fromList).toEqual(counts)
  })

  it("sin filtros respeta el alcance del usuario (no suma la faena ajena)", async () => {
    const { counts } = await tiles({}, VIEWER)

    expect(counts).toEqual({ open: 5, overdue: 1, pendingVerification: 1, unreconciled: 1, immediateStop: 1 })
  })
})

/**
 * Regla A5 (una dimensión = una representación interactiva): el estado dejó de ser
 * un `Select` más tarjetas por estado y es una fila de pestañas con contador; lo que
 * queda como tarjeta son condiciones que cruzan los estados (vencidas, exigen
 * detener la tarea, por conciliar). Los contadores de las pestañas se arman con la
 * MISMA cláusula que la lista, quitándole sólo el estado.
 */
describe("CAPA pestañas de estado — cuentan con los demás filtros y sin el de estado", () => {
  const BOTH_WORKSITES = {
    scope: { mode: "some", ids: ["ws-capa-list", "ws-capa-outside"] } as WorksiteScope,
    permissions: ["prevention:capa:view"],
  }
  const STATUS_ZERO = { pending: 0, in_progress: 0, pending_verification: 0, verified: 0, closed: 0, reopened: 0, cancelled: 0 }

  beforeEach(async () => {
    await inMemoryDb.insert(schema.preventionCapaActions).values([
      capa("inspection-open", { createdAt: "2026-08-07T08:00:00.000Z", sourceType: "inspection" }),
      capa("ws2-overdue", { createdAt: "2026-08-08T08:00:00.000Z", worksiteId: "ws-capa-outside", status: "in_progress", targetDate: "2020-01-01" }),
    ])
  })

  type StatusCountArgs = Parameters<typeof import("@/lib/services/prevention-capa").getCapaStatusCounts>[0]

  async function tabCounts(args: Partial<StatusCountArgs> = {}, base = VIEWER) {
    const { getCapaStatusCounts } = await import("@/lib/services/prevention-capa")
    return getCapaStatusCounts({ ...base, ...args } as StatusCountArgs)
  }

  /** Lo que la lista da al elegir esa pestaña, con los mismos filtros. */
  async function rowsFor(status: string | undefined, args: Record<string, unknown>, base = VIEWER) {
    const { listCapaActionsPage } = await import("@/lib/services/prevention-capa")
    const page = await listCapaActionsPage({ ...base, ...args, status, limit: 500 } as Parameters<typeof listCapaActionsPage>[0])
    return page.total
  }

  it("sin filtros cuenta cada estado del alcance del visor (sin la faena ajena)", async () => {
    const counts = await tabCounts()

    expect(counts.total).toBe(6)
    // Abiertas = ni cerradas ni canceladas: la verificada sigue abierta.
    expect(counts.open).toBe(5)
    expect(counts.byStatus).toEqual({ ...STATUS_ZERO, pending: 2, in_progress: 1, pending_verification: 1, verified: 1, closed: 1 })
  })

  it("el estado elegido no cambia los contadores: cada pestaña dice cuántas filas mostraría", async () => {
    const withoutStatus = await tabCounts({ sourceType: "manual" })
    const withStatus = await tabCounts({ sourceType: "manual", status: "closed" } as Partial<StatusCountArgs>)

    expect(withStatus).toEqual(withoutStatus)
    expect(withoutStatus.byStatus.pending).toBe(1)
  })

  it("respeta faena y fuente igual que la lista", async () => {
    expect((await tabCounts({ worksiteId: "ws-capa-outside" }, BOTH_WORKSITES)).byStatus).toEqual({ ...STATUS_ZERO, pending: 1, in_progress: 1 })
    expect((await tabCounts({ sourceType: "inspection" })).byStatus).toEqual({ ...STATUS_ZERO, pending: 1 })
  })

  it("con una condición activa («Vencidas», «Exigen detener», «Por conciliar») cuenta sólo las filas que la cumplen", async () => {
    // Vencida = no verificada, no cerrada y con plazo pasado; exige detener = marca activa y no cerrada.
    expect((await tabCounts({ quickFilter: "overdue" })).byStatus).toEqual({ ...STATUS_ZERO, in_progress: 1 })
    expect((await tabCounts({ quickFilter: "immediate_stop" })).byStatus).toEqual({ ...STATUS_ZERO, in_progress: 1 })
    expect((await tabCounts({ quickFilter: "unreconciled" })).byStatus).toEqual({ ...STATUS_ZERO, in_progress: 1 })
  })

  it("cada pestaña es exactamente lo que la lista devuelve con ese estado (no pueden separarse)", async () => {
    const casos: Array<[Record<string, unknown>, typeof VIEWER]> = [
      [{}, VIEWER], [{}, BOTH_WORKSITES], [{ worksiteId: "ws-capa-outside" }, BOTH_WORKSITES], [{ sourceType: "inspection" }, VIEWER],
      [{ quickFilter: "overdue" }, BOTH_WORKSITES], [{ quickFilter: "immediate_stop" }, VIEWER], [{ quickFilter: "unreconciled", sourceType: "manual" }, VIEWER],
    ]
    for (const [args, base] of casos) {
      const counts = await tabCounts(args as Partial<StatusCountArgs>, base)
      for (const [status, total] of Object.entries(counts.byStatus)) expect(await rowsFor(status, args, base), `${JSON.stringify(args)} · ${status}`).toBe(total)
      expect(await rowsFor("open", args, base), `${JSON.stringify(args)} · open`).toBe(counts.open)
      expect(await rowsFor(undefined, args, base), `${JSON.stringify(args)} · todas`).toBe(counts.total)
    }
  })

  it("las tarjetas con una pestaña activa cuentan la intersección con ella: es lo que la lista mostraría", async () => {
    const { getCapaDashboardCounts } = await import("@/lib/services/prevention-capa")

    const closed = await getCapaDashboardCounts({ ...VIEWER, status: "closed" })
    const open = await getCapaDashboardCounts({ ...VIEWER, status: "open" })

    // «Cerrada» no tiene vencidas ni por detener (esas reglas excluyen lo cerrado).
    expect(closed).toEqual({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 })
    expect(open).toEqual({ open: 5, overdue: 1, pendingVerification: 1, unreconciled: 1, immediateStop: 1 })
    expect(await rowsFor("open", { quickFilter: "overdue" })).toBe(open.overdue)
    expect(await rowsFor("open", { quickFilter: "immediate_stop" })).toBe(open.immediateStop)
  })

  it("una faena fuera del alcance o un usuario sin alcance ven ceros, y sin permiso falla", async () => {
    expect(await tabCounts({ worksiteId: "ws-capa-outside" })).toEqual({ total: 0, open: 0, byStatus: STATUS_ZERO })
    expect(await tabCounts({}, { scope: { mode: "none", ids: [] } as WorksiteScope, permissions: ["prevention:capa:view"] })).toEqual({ total: 0, open: 0, byStatus: STATUS_ZERO })

    await expect(tabCounts({}, { ...VIEWER, permissions: [] })).rejects.toThrow()
  })
})
