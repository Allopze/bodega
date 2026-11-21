import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const loadFleet = vi.hoisted(() => vi.fn())

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/reports/export-metadata", () => ({ addExportMetadataSheet: vi.fn() }))
vi.mock("./access", () => ({ equipmentScope: () => "all", viewerFromSession: () => ({}) }))
vi.mock("./fleet", () => ({ loadFleet }))

const { exportEquipment } = await import("./export-equipment")

const SESSION = { user: { id: "u-1", email: "jefe@chome.test", name: "Jefe" } } as never

function fleetRow(code: string, lastPreventive: unknown) {
  return {
    vehicleId: `v-${code}`, code, plate: "AAAA-01", noPlate: false, typeName: "Camión", brandName: "Ford", model: null, year: 2011,
    worksiteName: "Santa Fe", scheduleName: "Pauta", unit: "km", workshop: null,
    status: { state: "al_dia", currentReading: null, nextReading: null, remaining: null, nextIntervalValue: null, lastPreventive },
  }
}

describe("Excel de equipos: origen de la última preventiva", () => {
  beforeEach(() => vi.clearAllMocks())

  it("la declarada sale rotulada y con su respaldo; la firmada, «Firmada» y su folio; sin preventiva, en blanco", async () => {
    loadFleet.mockResolvedValue([
      fleetRow("KA-1", { reading: 60_000, date: "2026-03-10", intervalValue: 20_000, origin: "declarada", evidence: "OT-1234" }),
      fleetRow("KA-2", { reading: 80_000, date: "2026-09-29", intervalValue: 40_000, origin: "firmada", evidence: "MANT-BIO-0012" }),
      fleetRow("KA-3", null),
    ])
    const { base64 } = await exportEquipment(SESSION, { vehicleIds: ["v-KA-1", "v-KA-2", "v-KA-3"], includeRetired: false, filters: {} })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(base64, "base64") as never)
    const sheet = workbook.getWorksheet("Equipos")!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1)
    const origin = headers.indexOf("Origen de la última preventiva") + 1
    const support = headers.indexOf("Respaldo") + 1
    expect(origin).toBeGreaterThan(0)
    expect(support).toBeGreaterThan(0)
    expect([2, 3, 4].map((r) => sheet.getRow(r).getCell(origin).value)).toEqual(["Declarada, anterior a la plataforma", "Firmada", ""])
    expect([2, 3, 4].map((r) => sheet.getRow(r).getCell(support).value)).toEqual(["OT-1234", "MANT-BIO-0012", ""])
  })
})
