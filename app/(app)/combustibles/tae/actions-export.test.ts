import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockFindMany = vi.fn()
const mockRecordAudit = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({
  guardPermission: vi.fn(),
  requirePermission: (...a: unknown[]) => mockRequirePermission(...a),
  can: (session: { user: { permissions: string[] } }, permission: string) => session.user.permissions.includes(permission),
}))
vi.mock("@/lib/auth/scope", () => ({ canAccessWorksite: () => true, worksiteScopeSql: () => undefined }))
vi.mock("@/db", () => ({ db: { query: { fuelTaeSubmissions: { findMany: (...a: unknown[]) => mockFindMany(...a) } } } }))
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a), recordStatusChange: vi.fn() }))
vi.mock("@/lib/services/fuel-tae", () => ({ createTaePublicLink: vi.fn(), revokeTaePublicLink: vi.fn(), reviewTaeSubmission: vi.fn() }))
vi.mock("@/lib/combustibles/control/projection", () => ({ projectTaeSubmissions: vi.fn() }))

const { exportTaeSubmissionsXlsxAction } = await import("./actions")

const row = {
  loadedAt: "2026-10-01T12:00:00.000Z", worksite: { name: "Faena" }, loadingPoint: { name: "Surtidor" },
  equipmentCodeSnapshot: "CAM-1", plateSnapshot: "AB1234", supervisorNameSnapshot: "Sofía Supervisora", driverNameSnapshot: "Diego Conductor",
  meterType: "odometer", meterReading: 100, meterReadingSource: "manual", liters: 50, removedSealNumber: "1", installedSealNumber: "2",
  manualIdentity: false, status: "submitted", notes: "",
}

async function headersFor(permissions: string[]) {
  mockRequirePermission.mockResolvedValue({ user: { id: "u", email: "u@test.cl", permissions: ["combustibles:tae_export", ...permissions], isGlobal: true, worksiteIds: [] } })
  mockFindMany.mockResolvedValue([row])
  const result = await exportTaeSubmissionsXlsxAction({ q: "Sofía" })
  if (!result.ok) throw new Error("export falló")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(result.data.base64, "base64") as never)
  const cells = wb.getWorksheet("Control TAE")!
  return { headers: (cells.getRow(1).values as unknown[]).slice(1), values: JSON.stringify(cells.getRow(2).values) }
}

describe("exportación TAE y datos personales (P-01)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin view_personal omite conductor y supervisor", async () => {
    const { headers, values } = await headersFor([])
    expect(headers).not.toContain("Conductor")
    expect(headers).not.toContain("Supervisor / líder")
    expect(values).not.toContain("Diego")
    expect(values).not.toContain("Sofía")
  })

  it("con view_personal los incluye", async () => {
    const { headers, values } = await headersFor(["combustibles:view_personal"])
    expect(headers).toEqual(expect.arrayContaining(["Conductor", "Supervisor / líder"]))
    expect(values).toContain("Diego")
  })
})
