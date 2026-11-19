import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

/**
 * La exportación del panel lleva activos e indicadores del período; los conteos
 * de «Requiere atención» son sólo del tablero. Sin esta prueba, la exportación
 * volvería a ejecutar (en silencio) las tres consultas de atención que no usa.
 */

const mocks = vi.hoisted(() => ({
  hub: vi.fn(),
  breakdown: vi.fn(),
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

// El desglose por contrato también arrastra la base: se entrega ya calculado. `contractVehicleIds`
// repite aquí su criterio (ventana del contrato que toca el período); el real tiene sus propias pruebas.
vi.mock("@/lib/services/contracts/contract-costs", () => ({
  getContractCostBreakdown: mocks.breakdown,
  contractVehicleIds: (
    windows: { vehicleId: string; contractId: string; validFrom: string; validTo: string | null }[],
    contractId: string,
    period: { from: string; to: string },
  ) => new Set(
    windows
      .filter((window) => window.contractId === contractId && window.validFrom <= period.to && (window.validTo === null || window.validTo >= period.from))
      .map((window) => window.vehicleId),
  ),
}))

vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }))

import { exportOperationalControlXlsxAction } from "@/app/(app)/control-operacional/actions"

const session = { user: { id: "u1", email: "qa@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["flota:view"] } } as unknown as Session

beforeEach(() => {
  mocks.hub.mockReset()
  mocks.breakdown.mockReset()
  mocks.breakdown.mockResolvedValue({
    worksites: [], availability: { fuel: false, workOrders: false, purchases: false }, contractOptions: [], windows: [],
  })
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
      canViewWorkOrders: false,
      canViewPurchaseCosts: false,
      canViewMaintenance: false,
    },
    gpsCross: {
      reporting24h: 0,
      totalVehicles: 0,
      maintenance: { overdue: 0, upcoming: 0, estimated: 0 },
      prevention: { operatingWithOverdueCapa: 0 },
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
          canViewMaintenance: false,
        },
        gpsCross: {
          reporting24h: 0,
          totalVehicles: 0,
          maintenance: { overdue: 0, upcoming: 0, estimated: 0 },
          prevention: { operatingWithOverdueCapa: 0 },
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

  describe("costo por contrato", () => {
    const vehicle = (id: string, code: string, contractName: string | null) => ({
      kind: "vehicle", id, code, name: `Camión · ${code}`, worksiteId: "w1", worksiteName: "Cholguan - Arauco", contractId: contractName ? "c1" : null, contractName, operationalStatusLabel: "Operativo",
    })
    const breakdown = {
      worksites: [{
        worksiteId: "w1", worksiteName: "Cholguan - Arauco", total: 3_000_000, partial: false,
        rows: [
          { kind: "contract", contractId: "c1", label: "Movimiento de residuos", clientName: "Maderas Arauco", status: "active", vehicleCount: 1, fuel: 1_000_000, workOrders: 500_000, purchases: 1_500_000, total: 3_000_000, partial: false },
          { kind: "unassigned", contractId: null, label: "Sin contrato", clientName: null, status: null, vehicleCount: 1, fuel: 0, workOrders: 0, purchases: 0, total: 0, partial: true },
        ],
      }],
      availability: { fuel: true, workOrders: true, purchases: true },
      contractOptions: [{ id: "c1", label: "Cholguan - Arauco · Movimiento de residuos" }],
      windows: [{ vehicleId: "v1", contractId: "c1", worksiteId: "w1", validFrom: "2026-01-01", validTo: null }],
    }

    async function exportContract(filters: Record<string, string>) {
      mocks.hub.mockResolvedValue({
        period: { from: "2026-07-25", to: "2026-10-22" },
        attention: { stoppedVehicles: null, fleetDocuments: null },
        degradedSources: [],
        assets: [vehicle("v1", "KA-1", "Movimiento de residuos"), vehicle("v2", "KA-2", null)],
        metrics: { availabilityPercent: null, stateCoveragePercent: null },
        permissions: {
          canViewFleet: false, canViewInspections: false, canViewCapa: false, canViewFuel: false, canViewCosts: false,
          canViewServiceEquipment: false, canViewWorkOrders: false, canViewPurchaseCosts: false, canViewMaintenance: false,
        },
        gpsCross: { reporting24h: 0, totalVehicles: 0, maintenance: { overdue: 0, upcoming: 0, estimated: 0 }, prevention: { operatingWithOverdueCapa: 0 } },
      })
      mocks.breakdown.mockResolvedValue(breakdown)
      const result = await exportOperationalControlXlsxAction({ from: "2026-07-25", to: "2026-10-22", ...filters })
      if (!result.ok) throw new Error(result.message)
      const ExcelJS = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as never)
      return workbook
    }

    it("agrega la hoja «Costo por contrato» y filtra activos por contrato", async () => {
      const all = await exportContract({})
      expect(all.getWorksheet("Activos")!.rowCount).toBe(3)

      const filtered = await exportContract({ contrato: "c1" })
      const assets = filtered.getWorksheet("Activos")!
      // Cabecera + sólo el equipo del contrato elegido.
      expect(assets.rowCount).toBe(2)
      const headers = assets.getRow(1).values as unknown[]
      expect(headers.indexOf("Contrato")).toBe(headers.indexOf("Faena") + 1)
      expect(assets.getRow(2).getCell(headers.indexOf("Contrato")).value).toBe("Movimiento de residuos")

      const sheet = filtered.getWorksheet("Costo por contrato")!
      expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
        "Faena", "Contrato", "Mandante", "Equipos", "Combustible", "Mano de obra (OT)", "Compras", "Total", "Parcial",
      ])
      expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual([
        "Cholguan - Arauco", "Movimiento de residuos", "Maderas Arauco", 1, 1_000_000, 500_000, 1_500_000, 3_000_000, "No",
      ])
      expect((sheet.getRow(3).values as unknown[]).slice(1, 3)).toEqual(["Cholguan - Arauco", "Sin contrato"])
      expect(sheet.getRow(3).getCell(9).value).toBe("Sí")
      expect(sheet.getRow(2).getCell(8).numFmt).toBe("$#,##0")
      // El desglose se pidió con los vehículos del hub, no con una consulta por equipo.
      expect(mocks.breakdown).toHaveBeenCalledWith(
        session,
        { from: "2026-07-25", to: "2026-10-22" },
        [{ id: "v1", worksiteId: "w1" }, { id: "v2", worksiteId: "w1" }],
      )
    })

    it("un contrato desconocido no filtra y sin componentes de costo no hay hoja", async () => {
      const unknown = await exportContract({ contrato: "otro" })
      expect(unknown.getWorksheet("Activos")!.rowCount).toBe(3)

      mocks.breakdown.mockResolvedValue({ ...breakdown, availability: { fuel: false, workOrders: false, purchases: false } })
      const result = await exportOperationalControlXlsxAction({ from: "2026-07-25", to: "2026-10-22" })
      if (!result.ok) throw new Error(result.message)
      const ExcelJS = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as never)
      expect(workbook.getWorksheet("Costo por contrato")).toBeUndefined()
    })
  })

  it("sin permiso no consulta nada", async () => {
    mocks.requireAnyPermission.mockRejectedValue(new Error("Forbidden"))

    const result = await exportOperationalControlXlsxAction({})

    expect(result.ok).toBe(false)
    expect(mocks.hub).not.toHaveBeenCalled()
  })
})
