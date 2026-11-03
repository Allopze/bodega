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
