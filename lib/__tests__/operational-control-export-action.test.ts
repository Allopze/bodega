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
    attention: { stoppedVehicles: null, fleetDocuments: null },
    degradedSources: [],
    assets: [],
    metrics: {
      availabilityPercent: null,
      stateCoveragePercent: null,
    },
    permissions: {
      canViewFleet: true,
      canViewInspections: false,
      canViewCapa: false,
      canViewFuel: false,
      canViewCosts: false,
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

  describe("compras vinculadas a equipos", () => {
    const vehicle = (code: string, purchaseAmount: number | null) => ({
      kind: "vehicle", code, name: `Camión · ${code}`, worksiteName: "Faena Norte", operationalStatusLabel: "Operativo", purchaseAmount,
    })

    async function exportWith(options: { canViewPurchaseCosts: boolean; amounts: (number | null)[] }) {
      mocks.hub.mockResolvedValue({
        period: { from: "2026-07-25", to: "2026-10-22" },
        attention: { stoppedVehicles: null, fleetDocuments: null },
        degradedSources: [],
        assets: options.amounts.map((amount, index) => vehicle(`KA-${index + 1}`, amount)),
        metrics: { availabilityPercent: null, stateCoveragePercent: null },
        permissions: {
          canViewFleet: false,
          canViewInspections: false,
          canViewCapa: false,
          canViewFuel: false,
          canViewCosts: false,
          canViewServiceEquipment: false,
          canViewWorkOrders: false,
          canViewPurchaseCosts: options.canViewPurchaseCosts,
        },
      })
      const result = await exportOperationalControlXlsxAction({ from: "2026-07-25", to: "2026-10-22" })
      if (!result.ok) throw new Error(result.message)
      const ExcelJS = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as never)
      return workbook
    }

    it("con purchasing:view lleva la columna en pesos, el indicador sumado y lo deja en la auditoría", async () => {
      const workbook = await exportWith({ canViewPurchaseCosts: true, amounts: [100_000, 50_000] })

      const assets = workbook.getWorksheet("Activos")!
      // Al releer el archivo las claves de columna no viajan: se ubica por el rótulo.
      const column = (assets.getRow(1).values as unknown[]).indexOf("Repuestos y servicios (OC)")
      expect(column).toBeGreaterThan(0)
      expect(assets.getRow(2).getCell(column).value).toBe(100_000)
      expect(assets.getRow(2).getCell(column).numFmt).toBe("$#,##0")
      expect(workbook.getWorksheet("Indicadores")!.getRow(4).values).toEqual([undefined, "Compras vinculadas a equipos", 150_000])
      expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
        newState: expect.objectContaining({ includesPurchaseCosts: true }),
      }))
    })

    it("sin la capacidad no hay columna, ni indicador, ni cifra en la auditoría", async () => {
      const workbook = await exportWith({ canViewPurchaseCosts: false, amounts: [null, null] })

      const headers = (workbook.getWorksheet("Activos")!.getRow(1).values as unknown[]).filter(Boolean)
      expect(headers).not.toContain("Repuestos y servicios (OC)")
      const labels = workbook.getWorksheet("Indicadores")!.getColumn(1).values as unknown[]
      expect(labels).not.toContain("Compras vinculadas a equipos")
      expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
        newState: expect.objectContaining({ includesPurchaseCosts: false }),
      }))
    })

    it("si la consulta de compras falló el indicador va vacío, no en 0", async () => {
      const workbook = await exportWith({ canViewPurchaseCosts: true, amounts: [null, null] })

      const row = workbook.getWorksheet("Indicadores")!.getRow(4)
      expect(row.getCell(1).value).toBe("Compras vinculadas a equipos")
      expect(row.getCell(2).value).toBeNull()
    })
  })

  it("sin permiso no consulta nada", async () => {
    mocks.requireAnyPermission.mockRejectedValue(new Error("Forbidden"))

    const result = await exportOperationalControlXlsxAction({})

    expect(result.ok).toBe(false)
    expect(mocks.hub).not.toHaveBeenCalled()
  })
})
