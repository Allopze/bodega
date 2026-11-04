/**
 * La exportación de Flota lleva la misma marca que la columna «Km/Hr» de la lista: «Lectura
 * objetada» dice «Sí» cuando el detector tiene un caso abierto sobre la última lectura, «No» cuando
 * hay lectura sin objeción y queda vacía cuando el equipo no tiene lectura (ahí no hay nada que
 * objetar, y «No» sería afirmar que la lectura está bien). Sin `combustibles:view` la columna no
 * existe, igual que las de litros y cargas.
 *
 * Prueba de unidad con el servicio simulado: la marca misma tiene su prueba contra la base en
 * `fleet-meter-readings.test.ts`.
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

const sessionWith = (permissions: string[]) => ({ user: { id: "u1", email: "gerencia@chome.cl", isGlobal: true, worksiteIds: [], permissions } })
const base = {
  type: "Camión", brand: null, model: null, year: null, worksiteName: "Faena A", isActive: true, operationalStatus: "operativo",
  responsibleName: null, nextExpiryDate: null, totalLiters: 100, loadCount: 3, totalFuelAmount: 90_000, openWorkOrders: null,
  lastOdometerReading: null, lastHourMeterReading: null, lastReadingAt: null, lastReadingObjection: null,
}
const OBJETADA = { ...base, id: "v1", plate: "AA-0001", lastOdometerReading: 1_030, lastReadingAt: "2026-10-13T15:00:00.000Z", lastReadingObjection: { caseId: "case-1", ruleLabel: "Kilometraje regresivo" } }
const LIMPIA = { ...base, id: "v2", plate: "AA-0002", lastOdometerReading: 52_000, lastReadingAt: "2026-10-12T15:00:00.000Z" }
const HOROMETRO_OBJETADO = { ...base, id: "v3", plate: "AA-0003", lastHourMeterReading: 90.5, lastReadingAt: "2026-10-14T15:00:00.000Z", lastReadingObjection: { caseId: "case-3", ruleLabel: "Horómetro regresivo" } }
const SIN_LECTURA = { ...base, id: "v4", plate: "AA-0004" }

/** Valor de cada columna de la hoja «Flota», por patente. */
async function flotaSheet(result: Awaited<ReturnType<typeof exportFleetXlsxAction>>) {
  if (!result.ok) throw new Error(result.message)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
  const sheet = workbook.getWorksheet("Flota")!
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
  const byPlate = new Map<string, Record<string, unknown>>()
  sheet.eachRow((row, index) => {
    if (index === 1) return
    const values = (row.values as unknown[]).slice(1)
    byPlate.set(String(values[0]), Object.fromEntries(headers.map((header, column) => [header, values[column]])))
  })
  return { headers, byPlate }
}

describe("exportFleetXlsxAction · columna «Última lectura» (P-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGapMonths.mockResolvedValue([])
    mockGetFleetOverview.mockResolvedValue([OBJETADA, LIMPIA, HOROMETRO_OBJETADO, SIN_LECTURA])
  })

  it("lleva el valor y la fecha de la última lectura, igual que «Km/Hr» de la lista, y la marca de objetada con su regla", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view"]))

    const { headers, byPlate } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(headers).toContain("Última lectura")
    expect(byPlate.get("AA-0002")?.["Última lectura"]).toBe("52.000 km · 12-10-2026")
    expect(byPlate.get("AA-0001")?.["Última lectura"]).toBe("1.030 km · 13-10-2026 · Lectura objetada: Kilometraje regresivo")
    // Horómetro, con coma decimal de es-CL.
    expect(byPlate.get("AA-0003")?.["Última lectura"]).toBe("90,5 h · 14-10-2026 · Lectura objetada: Horómetro regresivo")
  })

  it("la marca coincide con la columna «Lectura objetada»: donde dice «Sí» la última lectura lo dice también", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view"]))

    const { byPlate } = await flotaSheet(await exportFleetXlsxAction({}))

    for (const [, row] of byPlate) {
      expect(String(row["Última lectura"] ?? "").includes("Lectura objetada")).toBe(row["Lectura objetada"] === "Sí")
    }
  })

  it("un equipo sin lectura queda con la celda vacía", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view"]))

    const { byPlate } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(byPlate.get("AA-0004")?.["Última lectura"] ?? "").toBe("")
  })

  it("sin combustibles:view la columna no existe (la lectura sale de las cargas de combustible)", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view"]))

    const { headers } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(headers).not.toContain("Última lectura")
  })
})

describe("exportFleetXlsxAction · columna «Lectura objetada»", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGapMonths.mockResolvedValue([])
    mockGetFleetOverview.mockResolvedValue([OBJETADA, LIMPIA, HOROMETRO_OBJETADO, SIN_LECTURA])
  })

  it("dice «Sí» donde hay un caso abierto sobre la lectura y «No» donde la lectura no tiene objeción", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view", "combustibles:view_costs"]))

    const { headers, byPlate } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(headers).toContain("Lectura objetada")
    expect(byPlate.get("AA-0001")?.["Lectura objetada"]).toBe("Sí")
    expect(byPlate.get("AA-0002")?.["Lectura objetada"]).toBe("No")
    expect(byPlate.get("AA-0003")?.["Lectura objetada"]).toBe("Sí")
  })

  it("un equipo sin lectura queda con la celda vacía: no hay nada que objetar", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view"]))

    const { byPlate } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(byPlate.get("AA-0004")?.["Lectura objetada"] ?? "").toBe("")
  })

  it("sin combustibles:view la columna no existe", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view"]))

    const { headers } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(headers).not.toContain("Lectura objetada")
  })

  it("quien no ve costos exporta igual (la columna de costo no existe y no hay nada que formatear)", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view"]))

    const { headers } = await flotaSheet(await exportFleetXlsxAction({}))

    expect(headers).not.toContain("Costo combustible")
    expect(headers).toContain("Lectura objetada")
  })

  it("con costos, la columna de costo conserva su formato de moneda", async () => {
    mockRequirePermission.mockResolvedValue(sessionWith(["flota:view", "combustibles:view", "combustibles:view_costs"]))
    const result = await exportFleetXlsxAction({})
    if (!result.ok) throw new Error(result.message)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
    const sheet = workbook.getWorksheet("Flota")!
    const costColumn = (sheet.getRow(1).values as unknown[]).slice(1).indexOf("Costo combustible") + 1

    expect(costColumn).toBeGreaterThan(0)
    expect(sheet.getCell(2, costColumn).numFmt).toBe("$#,##0")
  })
})
