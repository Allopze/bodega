/**
 * C-4 en la exportación de Flota: las columnas «Litros (12 meses)», «Cargas (12 meses)» y
 * «Costo combustible» suman lo que Copec informó. Cuando un mes de la ventana no trae datos,
 * la hoja «Metadatos» —lo que viaja con el archivo— lo dice con una fila «Nota».
 *
 * Prueba de unidad con el servicio simulado: el cálculo de los meses sin datos tiene su prueba
 * contra la base en `fleet-fuel-provider.test.ts`.
 */
import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockGetFleetOverview = vi.hoisted(() => vi.fn())
const mockGetGapMonths = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  can: (session: { user: { permissions: string[] } }, permission: string) => session.user.permissions.includes(permission),
}))
vi.mock("@/lib/storage/config", () => ({ resolveFleetDir: vi.fn(), createFleetDocumentPath: vi.fn(), resolveStorageFile: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/system-settings", () => ({ getFleetAdminSettings: vi.fn(async () => ({ warningDays: 30 })) }))
vi.mock("@/lib/services/fleet", () => ({
  FLEET_OVERVIEW_LOOKBACK_MONTHS: 12,
  uploadFleetDocument: vi.fn(),
  deleteFleetDocument: vi.fn(),
  getFleetOverview: mockGetFleetOverview,
  getFleetProviderGapMonths: mockGetGapMonths,
}))

import { exportFleetXlsxAction } from "@/app/(app)/flota/actions"

const session = { user: { id: "u1", email: "gerencia@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view", "combustibles:view_costs"] } }
const row = {
  id: "v1", plate: "AA-0001", type: "Camión", brand: null, model: null, year: null, worksiteName: "Faena A", isActive: true,
  operationalStatus: "operativo", responsibleName: null, nextExpiryDate: null, totalLiters: 100, loadCount: 3, totalFuelAmount: 90_000, openWorkOrders: null,
}

async function metadataOf(result: Awaited<ReturnType<typeof exportFleetXlsxAction>>) {
  if (!result.ok) throw new Error(result.message)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
  const sheet = workbook.getWorksheet("Metadatos")!
  const entries: Array<[string, string]> = []
  sheet.eachRow((metaRow) => entries.push([String(metaRow.getCell(1).value), String(metaRow.getCell(2).value)]))
  return entries
}

describe("exportFleetXlsxAction · aviso de meses sin datos del proveedor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    mockGetFleetOverview.mockResolvedValue([row])
  })

  it("agrega una nota a «Metadatos» nombrando los meses que los totales no incluyen", async () => {
    mockGetGapMonths.mockResolvedValue(["2025-11", "2025-12", "2026-09"])

    const entries = await metadataOf(await exportFleetXlsxAction({}))

    expect(entries.filter(([label]) => label === "Nota")).toEqual([
      ["Nota", "Sin datos del proveedor en nov-2025, dic-2025 y sep-2026: los totales de 12 meses no incluyen esos meses."],
    ])
  })

  it("sin meses sin datos no hay nota: la hoja queda como siempre", async () => {
    mockGetGapMonths.mockResolvedValue([])

    const entries = await metadataOf(await exportFleetXlsxAction({}))

    expect(entries.some(([label]) => label === "Nota")).toBe(false)
    expect(entries.map(([label]) => label)).toContain("Filas incluidas")
  })
})
