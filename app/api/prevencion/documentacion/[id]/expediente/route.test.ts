import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockBundle = vi.hoisted(() => vi.fn())
const mockRecordDownload = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-documents-library", () => ({
  getDocumentBundle: mockBundle,
  recordDocumentDownload: mockRecordDownload,
}))

describe("document evidence workbook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["prevention:docs:view"] } })
    mockCan.mockReturnValue(true)
    mockBundle.mockResolvedValue({
      doc: { id: "doc-1", internalCode: "PTS-1", title: "=cmd", worksiteId: "ws-1", currentVersionId: "v1", status: "vigente" },
      versions: [{ id: "v1", version: 1, status: "vigente", fileName: "pts.pdf", checksum: "a".repeat(64), uploadedBy: "user-1", reviewedBy: "reviewer", approvedBy: "approver", approvedAt: "2026-07-18T00:00:00Z", supersedesId: null, createdAt: "2026-07-18T00:00:00Z" }],
      distribution: [{ id: "target-1", versionId: "v1", userId: "user-2", workerId: null, assignmentReason: "cargo", worksiteId: "ws-1", assignedByUserId: "user-1", assignedAt: "2026-07-18T00:00:00Z", dueAt: null, status: "acusado", exemptionReason: null, reminderCount: 1, lastReminderAt: "2026-07-18T00:00:00Z" }],
      acks: [{ id: "ack-1", versionId: "v1", userId: "user-2", signature: "b".repeat(64), acknowledgedAt: "2026-07-18T01:00:00Z" }],
      links: [],
      audit: [{ id: "audit-1", action: "approve", versionId: "v1", userId: "approver", fromStatus: "en_revision", toStatus: "aprobado", comment: "conforme", metadata: {}, createdAt: "2026-07-18T00:00:00Z" }],
    })
  })

  it("exports version, distribution, ack and audit evidence in Excel", async () => {
    const { GET } = await import("./route")
    const response = await GET(new Request("http://localhost/api/prevencion/documentacion/doc-1/expediente"), {
      params: Promise.resolve({ id: "doc-1" }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Documento", "Versiones", "Distribución", "Acuses", "Vínculos", "Bitácora",
    ])
    const documentSheet = workbook.getWorksheet("Documento")!
    const titleRow = documentSheet.getRows(2, documentSheet.rowCount - 1)?.find((row) => row.getCell(1).value === "title")
    expect(titleRow?.getCell(2).value).toBe("'=cmd")
    expect(workbook.getWorksheet("Acuses")?.getCell("F2").value).toBe("a".repeat(64))
    expect(mockRecordDownload).toHaveBeenCalledWith(expect.objectContaining({ source: "expediente_xlsx" }))
  })
})
