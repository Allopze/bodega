import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

/**
 * La exportación del panel lleva activos e indicadores del período; los conteos
 * de «Requiere atención» son sólo del tablero. Sin esta prueba, la exportación
 * volvería a ejecutar (en silencio) las tres consultas de atención que no usa.
 */

const mocks = vi.hoisted(() => ({
  hub: vi.fn(),
  requireAnyPermission: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: mocks.requireAnyPermission,
  can: vi.fn(() => false),
  canAny: vi.fn(() => false),
  isGlobalRole: vi.fn(() => false),
}))

// El servicio real arrastra la base; la acción sólo necesita el hub y el período.
vi.mock("@/lib/services/operational-control", () => ({
  getOperationalControlHub: mocks.hub,
  resolveOperationalControlPeriod: (input: { from?: string; to?: string } = {}) => ({
    from: input.from ?? "2026-07-25",
    to: input.to ?? "2026-10-22",
  }),
}))

vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }))

import { exportOperationalControlXlsxAction } from "@/app/(app)/control-operacional/actions"

const session = { user: { id: "u1", email: "qa@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["flota:view"] } } as unknown as Session

beforeEach(() => {
  mocks.hub.mockReset()
  mocks.requireAnyPermission.mockReset()
  mocks.recordAudit.mockReset()
  mocks.requireAnyPermission.mockResolvedValue(session)
  mocks.hub.mockResolvedValue({
    period: { from: "2026-07-25", to: "2026-10-22" },
    // Sin consultas de atención, el hub deja sus campos en null.
    attention: { stoppedVehicles: null, fleetDocuments: null, openWorkOrders: null },
    assets: [],
    metrics: {
      availabilityPercent: null,
      mttrHours: null,
      mtbfHours: null,
      preventiveCompliancePercent: null,
      downtimeHours: 0,
      backlog: 0,
      maintenanceCost: null,
    },
    sourceHealth: [],
    permissions: {
      canViewFleet: true,
      canViewMaintenance: false,
      canViewInspections: false,
      canViewCosts: false,
      canViewFuelImport: false,
      canViewServiceEquipment: false,
    },
  })
})

describe("exportOperationalControlXlsxAction", () => {
  it("pide el hub sin los conteos de atención", async () => {
    const result = await exportOperationalControlXlsxAction({ from: "2026-07-25", to: "2026-10-22" })

    expect(result.ok).toBe(true)
    expect(mocks.hub).toHaveBeenCalledTimes(1)
    expect(mocks.hub).toHaveBeenCalledWith(
      session,
      { from: "2026-07-25", to: "2026-10-22" },
      { includeAttention: false },
    )
  })

  it("sin permiso no consulta nada", async () => {
    mocks.requireAnyPermission.mockRejectedValue(new Error("Forbidden"))

    const result = await exportOperationalControlXlsxAction({})

    expect(result.ok).toBe(false)
    expect(mocks.hub).not.toHaveBeenCalled()
  })
})
