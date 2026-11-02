import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Fase 5: el costo comprometido no es el aprobado, el SLA y la asignación se
 * cruzan con las OT abiertas, y la adherencia al plan no se confunde con el
 * cumplimiento de las OT que ya existen.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getOperationalControlHub } = await import("@/lib/services/operational-control")

function session(permissions: string[]): Session {
  return {
    user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.insert(schema.maintenancePlans).values([
    {
      id: "ocm-plan-1",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      name: "Plan con OT",
      maintenanceType: "preventiva",
      strategy: "calendar",
      intervalDays: 30,
      nextDueDate: "2026-03-12",
      createdBy: IDS.user,
    },
    {
      id: "ocm-plan-2",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      name: "Plan sin OT",
      maintenanceType: "preventiva",
      strategy: "calendar",
      intervalDays: 30,
      nextDueDate: "2026-03-20",
      createdBy: IDS.user,
    },
    {
      id: "ocm-plan-3",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      name: "Plan fuera del período",
      maintenanceType: "preventiva",
      strategy: "calendar",
      intervalDays: 30,
      nextDueDate: "2026-05-01",
      createdBy: IDS.user,
    },
  ])

  await testDb.insert(schema.maintenanceRecords).values([
    {
      id: "ocm-ot-1",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      maintenanceDate: "2026-03-10",
      maintenanceType: "preventiva",
      status: "scheduled",
      priority: "high",
      slaDueAt: "2020-01-01T00:00:00.000Z",
      totalAmount: 1000,
      costApprovalStatus: "pending",
      createdBy: IDS.user,
    },
    {
      id: "ocm-ot-2",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      planId: "ocm-plan-1",
      maintenanceDate: "2026-03-12",
      maintenanceType: "preventiva",
      status: "completed",
      assignedToUserId: IDS.user,
      totalAmount: 500,
      costApprovalStatus: "approved",
      createdBy: IDS.user,
    },
    {
      id: "ocm-ot-3",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      maintenanceDate: "2026-03-15",
      maintenanceType: "correctiva",
      status: "completed",
      assignedToUserId: IDS.user,
      totalAmount: 300,
      costApprovalStatus: "pending",
      createdBy: IDS.user,
    },
    {
      id: "ocm-ot-4",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      maintenanceDate: "2026-03-18",
      maintenanceType: "correctiva",
      status: "completed",
      assignedToUserId: IDS.user,
      totalAmount: 200,
      costApprovalStatus: "not_required",
      createdBy: IDS.user,
    },
    {
      id: "ocm-ot-5",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      maintenanceDate: "2026-03-20",
      maintenanceType: "preventiva",
      status: "cancelled",
      totalAmount: 999,
      costApprovalStatus: "approved",
      cancelledAt: "2026-03-20T00:00:00.000Z",
      cancellationReason: "Duplicada",
      createdBy: IDS.user,
    },
  ])
}, 120_000)

describe("Panel operacional: mantención, SLA y plan", () => {
  it("separa costo aprobado de comprometido y cruza SLA y asignación", async () => {
    const hub = await getOperationalControlHub(
      session(["mantenciones:view", "combustibles:view_costs"]),
      MARCH,
      { includeAttention: false },
    )
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!

    // Comprometido: 1000 + 500 + 300 + 200; la cancelada no cuenta.
    // Aprobado: 500 + 200 (aprobada y no requerida).
    expect(hub.metrics.maintenanceCost).toBe(2000)
    expect(hub.metrics.maintenanceCostApproved).toBe(700)
    expect(a).toMatchObject({
      maintenanceCost: 2000,
      maintenanceCostApproved: 700,
      openSlaOverdue: 1,
      unassignedOpen: 1,
      nextPlanDue: "2026-03-12",
    })
  })

  it("calcula la adherencia al plan y no cuenta planes fuera del período", async () => {
    const hub = await getOperationalControlHub(
      session(["mantenciones:view", "combustibles:view_costs"]),
      MARCH,
      { includeAttention: false },
    )

    // Plan 1 (con OT) y plan 2 (sin OT) vencen en marzo; el plan 3 es de mayo.
    expect(hub.metrics.planAdherencePercent).toBe(50)
  })

  it("sin combustibles:view_costs no devuelve montos, pero sí SLA, asignación y plan", async () => {
    const hub = await getOperationalControlHub(session(["mantenciones:view"]), MARCH, { includeAttention: false })
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!

    expect(hub.metrics.maintenanceCost).toBeNull()
    expect(hub.metrics.maintenanceCostApproved).toBeNull()
    expect(a.maintenanceCost).toBeNull()
    expect(a.maintenanceCostApproved).toBeNull()
    expect(a.openSlaOverdue).toBe(1)
    expect(a.unassignedOpen).toBe(1)
    expect(a.nextPlanDue).toBe("2026-03-12")
    expect(hub.metrics.planAdherencePercent).toBe(50)
  })
})
