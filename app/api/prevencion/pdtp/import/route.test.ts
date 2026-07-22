import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockStage = vi.hoisted(() => vi.fn())
const mockApply = vi.hoisted(() => vi.fn())
const mockCancel = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  stagePdtpXlsxImport: mockStage,
  applyPdtpImportBatch: mockApply,
  cancelPdtpImportBatch: mockCancel,
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

import { POST } from "./route"

function session(worksiteIds = ["ws-1"], isGlobal = false) {
  return { user: { id: "user-1", roles: [isGlobal ? "administrador" : "prevencionista_faena"], permissions: ["prevention:pdtp:program:manage"], worksiteIds, isGlobal } }
}

function formRequest(fields: Record<string, string>, file?: File) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  if (file) form.set("file", file)
  return new Request("http://localhost/api/prevencion/pdtp/import", { method: "POST", body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session: session(), error: null })
  mockStage.mockResolvedValue({
    batch: { id: "batch-1" },
    preview: { batchId: "batch-1", status: "staged", counts: { activities: 89 } },
  })
  mockApply.mockResolvedValue({ batchId: "batch-1", importedExecutionCount: 6 })
  mockCancel.mockResolvedValue({ batchId: "batch-1", cancelled: true })
})

describe("POST PDTP XLSX import staging", () => {
  it("fails closed without the program-management permission", async () => {
    mockGuardPermission.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const response = await POST(formRequest({ mode: "stage", programId: "p1" }))
    expect(response.status).toBe(403)
    expect(mockStage).not.toHaveBeenCalled()
  })

  it("rejects legacy .xls explicitly", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "programa.xls", { type: "application/vnd.ms-excel" })
    const response = await POST(formRequest({ mode: "stage", programId: "p1" }, file))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/\.xls no está permitido/i) })
    expect(mockStage).not.toHaveBeenCalled()
  })

  it("persists a preview without calling apply", async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "programa.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const response = await POST(formRequest({ mode: "stage", programId: "p1" }, file))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, batchId: "batch-1", preview: { status: "staged" } })
    expect(mockStage).toHaveBeenCalledWith(expect.objectContaining({ programId: "p1", fileName: "programa.xlsx", userId: "user-1" }))
    expect(mockApply).not.toHaveBeenCalled()
  })

  it("applies a staged batch with the caller worksite scope and explicit historical acceptance", async () => {
    const response = await POST(formRequest({
      mode: "apply",
      batchId: "batch-1",
      worksiteId: "ws-1",
      acceptMissingEvidence: "true",
      acceptanceReason: "Histórico validado por prevención",
    }))
    expect(response.status).toBe(200)
    expect(mockApply).toHaveBeenCalledWith({
      batchId: "batch-1",
      userId: "user-1",
      worksiteId: "ws-1",
      acceptMissingEvidence: true,
      acceptanceReason: "Histórico validado por prevención",
      scope: ["ws-1"],
    })
  })

  it("propagates an apply rejection without mutating through the route", async () => {
    mockApply.mockRejectedValue(new Error("La faena seleccionada no existe o está inactiva."))
    const response = await POST(formRequest({ mode: "apply", batchId: "batch-1", worksiteId: "ws-2" }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/faena.*inactiva/i) })
  })

  it("persists cancellation of a staged preview with its reason", async () => {
    const response = await POST(formRequest({
      mode: "cancel",
      batchId: "batch-1",
      reason: "El archivo no corresponde a la versión vigente",
    }))
    expect(response.status).toBe(200)
    expect(mockCancel).toHaveBeenCalledWith({
      batchId: "batch-1",
      userId: "user-1",
      reason: "El archivo no corresponde a la versión vigente",
    })
    expect(await response.json()).toMatchObject({ ok: true, result: { cancelled: true } })
  })
})
