import { afterEach, describe, expect, it, vi } from "vitest"
import { createNotifications } from "@/lib/services/notification-create"

const queryResults: unknown[][] = []

function chain(data: unknown[]) {
  const query: Record<string, unknown> = {}
  query.from = vi.fn(() => query)
  query.where = vi.fn(() => query)
  query.innerJoin = vi.fn(() => query)
  query.leftJoin = vi.fn(() => query)
  query.then = (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(data).then(resolve, reject)
  return query
}

const select = vi.fn((_projection?: unknown) => chain(queryResults.shift() ?? []))

vi.mock("@/db", () => ({ db: { select: (projection?: unknown) => select(projection) } }))
vi.mock("@/lib/services/notification-create", () => ({ createNotifications: vi.fn() }))

import { runMaintenanceReminders } from "@/lib/services/maintenance-reminders"

afterEach(() => {
  vi.clearAllMocks()
  queryResults.length = 0
})

describe("runMaintenanceReminders", () => {
  it("notifica al responsable por una OT próxima sin escalarla", async () => {
    queryResults.push([
      { id: "ot-1", code: "OT-2026-0001", worksiteId: "ws-1", assignedToUserId: "u-asignado", assignedToUserIsActive: true, slaDueAt: "2026-08-22T20:00:00.000Z", priority: "normal" },
    ], [
      { userId: "u-jefe", isGlobal: false, worksiteId: "ws-1" },
    ])

    await expect(runMaintenanceReminders(new Date("2026-08-22T10:00:00.000Z"))).resolves.toEqual({
      examined: 1,
      dueSoon: 1,
      overdue: 0,
      deliveries: 1,
    })
    expect(createNotifications).toHaveBeenCalledWith(["u-asignado"], expect.objectContaining({
      type: "maintenance_due_soon",
      dedupeKey: "maintenance:ot-1:due-soon:2026-08-22T20:00:00.000Z",
      entityHref: "/mantenciones/ot-1",
    }))
  })

  it("escala vencidas al jefe de mantención de la faena y al global sin duplicar receptores", async () => {
    queryResults.push([
      { id: "ot-2", code: "OT-2026-0002", worksiteId: "ws-1", assignedToUserId: "u-jefe-local", assignedToUserIsActive: true, slaDueAt: "2026-08-22T09:00:00.000Z", priority: "critical" },
    ], [
      { userId: "u-jefe-local", isGlobal: false, worksiteId: "ws-1" },
      { userId: "u-jefe-otra", isGlobal: false, worksiteId: "ws-2" },
      { userId: "u-jefe-global", isGlobal: true, worksiteId: null },
    ])

    await expect(runMaintenanceReminders(new Date("2026-08-22T10:00:00.000Z"))).resolves.toEqual({
      examined: 1,
      dueSoon: 0,
      overdue: 1,
      deliveries: 2,
    })
    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining(["u-jefe-local", "u-jefe-global"]),
      expect.objectContaining({ type: "maintenance_overdue", dedupeKey: "maintenance:ot-2:overdue:2026-08-22T09:00:00.000Z" }),
    )
    expect(createNotifications).toHaveBeenCalledWith(expect.not.arrayContaining(["u-jefe-otra"]), expect.anything())
  })

  it("trata como no asignada una OT cuyo responsable fue desactivado", async () => {
    queryResults.push([
      { id: "ot-3", code: "OT-2026-0003", worksiteId: "ws-1", assignedToUserId: "u-inactivo", assignedToUserIsActive: false, slaDueAt: "2026-08-22T20:00:00.000Z", priority: "normal" },
    ], [
      { userId: "u-jefe", isGlobal: false, worksiteId: "ws-1" },
    ])

    await runMaintenanceReminders(new Date("2026-08-22T10:00:00.000Z"))

    expect(createNotifications).toHaveBeenCalledWith(["u-jefe"], expect.objectContaining({
      type: "maintenance_due_soon",
    }))
  })
})
