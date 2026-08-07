import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import {
  createMaintenanceRecord,
  getUpcomingMaintenance,
  getUsageMaintenanceAlerts,
  updateMaintenanceRecord,
  type CreateMaintenanceInput,
} from "@/lib/services/maintenance"

const mockFindFirst = vi.fn()
const mockVehicleFindMany = vi.fn()
const mockMaintenanceFindFirst = vi.fn()
const mockMaintenanceFindMany = vi.fn()
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(true) })

function createChain() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve([]).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
        findMany: (...args: unknown[]) => mockVehicleFindMany(...args),
      },
      maintenanceRecords: {
        findFirst: (...args: unknown[]) => mockMaintenanceFindFirst(...args),
        findMany: (...args: unknown[]) => mockMaintenanceFindMany(...args),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    select: () => createChain(),
  },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

/** Trozos literales y parámetros de un predicado de Drizzle, sin levantar Postgres. */
function sqlChunks(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const item of node) sqlChunks(item, out)
    return out
  }
  const candidate = node as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(candidate.queryChunks)) {
    for (const chunk of candidate.queryChunks) sqlChunks(chunk, out)
    return out
  }
  if (typeof candidate.value === "string") out.push(candidate.value)
  else if (Array.isArray(candidate.value)) {
    for (const part of candidate.value) if (typeof part === "string") out.push(part)
  }
  return out
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("Maintenance Service (createMaintenanceRecord)", () => {
  const dummySession = {
    user: { id: "user-1", email: "mantencion@chome.cl", role: "admin" },
  } as unknown as Session

  it("rejects maintenance record creation for non-existent vehicle", async () => {
    mockFindFirst.mockResolvedValueOnce(null)

    const input: CreateMaintenanceInput = {
      vehicleId: "veh-nonexistent",
      maintenanceDate: "2026-07-22",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 100000,
      taxAmount: 19000,
      totalAmount: 119000,
    }

    await expect(createMaintenanceRecord(dummySession, input)).rejects.toThrow("Vehículo no encontrado")
  })

  it("checks worksite access scope when session is restricted", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "veh-1", worksiteId: "ws-restricted" })

    const restrictedSession = {
      user: { id: "user-2", role: "user", worksiteIds: ["ws-allowed"] },
    } as unknown as Session

    const input: CreateMaintenanceInput = {
      vehicleId: "veh-1",
      worksiteId: "ws-restricted",
      maintenanceDate: "2026-07-22",
      maintenanceType: "correctiva",
      status: "in_progress",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    }

    await expect(createMaintenanceRecord(restrictedSession, input)).rejects.toThrow("No puedes registrar mantenciones para esta faena")
  })

  // HALLAZGO 21: imputar a una faena propia no puede habilitar escribir sobre
  // un vehículo de otra faena.
  it("rechaza un vehículo de otra faena aunque la faena imputada esté en el alcance", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "veh-2", worksiteId: "ws-antofagasta" })

    const restrictedSession = {
      user: { id: "user-2", role: "user", worksiteIds: ["ws-santiago"] },
    } as unknown as Session

    await expect(createMaintenanceRecord(restrictedSession, {
      vehicleId: "veh-2",
      worksiteId: "ws-santiago",
      maintenanceDate: "2026-08-07",
      maintenanceType: "correctiva",
      status: "completed",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    })).rejects.toThrow("No puedes registrar mantenciones para este vehículo")
  })
})

describe("Maintenance Service (updateMaintenanceRecord)", () => {
  // HALLAZGO 21: misma causa — re-apuntar una mantención propia a un equipo ajeno.
  it("rechaza re-apuntar una mantención propia a un vehículo de otra faena", async () => {
    mockMaintenanceFindFirst.mockResolvedValueOnce({ id: "man-1", worksiteId: "ws-santiago" })
    mockFindFirst.mockResolvedValueOnce({ id: "veh-2", worksiteId: "ws-antofagasta" })

    const restrictedSession = {
      user: { id: "user-2", role: "user", worksiteIds: ["ws-santiago"] },
    } as unknown as Session

    await expect(updateMaintenanceRecord(restrictedSession, "man-1", {
      vehicleId: "veh-2",
      worksiteId: "ws-santiago",
      maintenanceDate: "2026-08-07",
      maintenanceType: "correctiva",
      status: "completed",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    })).rejects.toThrow("No puedes asignar mantenciones a este vehículo")
  })
})

describe("getUpcomingMaintenance", () => {
  const globalSession = { user: { id: "user-1", isGlobal: true, worksiteIds: [] } } as unknown as Session

  // HALLAZGO 36: 2026-08-08T01:30Z son las 21:30 del 07-08 en Chile (UTC−4).
  // Con `toISOString()` la mantención de hoy caía en "vencidas".
  it("usa el día chileno, no el UTC, para separar vencidas de próximas", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-08T01:30:00Z"))
    mockMaintenanceFindMany.mockResolvedValue([])

    await getUpcomingMaintenance(globalSession)

    const wheres = mockMaintenanceFindMany.mock.calls.map((call) => sqlChunks((call[0] as { where: unknown }).where))
    expect(wheres).toHaveLength(2)
    for (const where of wheres) {
      expect(where).toContain("2026-08-07")
      expect(where).not.toContain("2026-08-08")
    }
    // La ventana de 30 días arranca del día chileno, no del UTC.
    expect(wheres[0]).toContain("2026-09-06")
  })
})

describe("getUsageMaintenanceAlerts", () => {
  // HALLAZGO 11: la faena elegida en el tablero tiene que reencuadrar la alerta.
  it("acota los vehículos a la faena elegida en el tablero", async () => {
    const scopedSession = { user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-1", "ws-2"] } } as unknown as Session
    mockVehicleFindMany.mockResolvedValue([])

    await getUsageMaintenanceAlerts(scopedSession, "ws-1")

    const where = sqlChunks((mockVehicleFindMany.mock.calls[0]![0] as { where: unknown }).where)
    expect(where).toContain("ws-1")
    expect(where).not.toContain("ws-2")
  })
})
