/**
 * FX-B (B9): la evidencia de una CAPA no tenía dónde subirse. El contrato único
 * de evidencia exige, para un documento o una fotografía, una ruta del storage
 * de evidencia más su SHA-256; el formulario mandaba texto libre sin checksum,
 * así que sólo una URL pasaba. Esta ruta guarda el archivo y devuelve ambos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockAssertUpload = vi.hoisted(() => vi.fn())
const mockMkdirp = vi.hoisted(() => vi.fn())
const mockWriteBuffer = vi.hoisted(() => vi.fn())
// PRV-01: la subida deja la fila de dueño en `prevention_evidence_uploads`.
const mockInsertValues = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("@/lib/services/prevention-capa", () => ({ assertCapaEvidenceUploadAllowed: mockAssertUpload }))
vi.mock("@/lib/storage/helpers", () => ({ mkdirp: mockMkdirp, writeBuffer: mockWriteBuffer }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock("@/db", () => ({ db: { insert: () => ({ values: mockInsertValues }) } }))

const session = { user: { id: "user-1", permissions: ["prevention:capa:complete"] } }
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

function makeRequest(fields: { actionId?: string; file?: File }) {
  const form = new FormData()
  if (fields.actionId !== undefined) form.set("actionId", fields.actionId)
  if (fields.file) form.set("file", fields.file)
  return { formData: async () => form } as unknown as Request
}

describe("POST /api/prevencion/capa/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-1"] })
    mockAssertUpload.mockResolvedValue(undefined)
    mockMkdirp.mockResolvedValue(undefined)
    mockWriteBuffer.mockResolvedValue(undefined)
    mockInsertValues.mockResolvedValue(undefined)
  })

  it("exige prevention:capa:complete", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ actionId: "capa-1", file: new File([PDF_BYTES], "acta.pdf") }))
    expect(res.status).toBe(403)
    expect(mockGuardPermission).toHaveBeenCalledWith("prevention:capa:complete")
    expect(mockWriteBuffer).not.toHaveBeenCalled()
  })

  it("no guarda nada si la CAPA está fuera de la faena de quien sube", async () => {
    mockAssertUpload.mockRejectedValueOnce(new Error("Acción CAPA no encontrada o fuera de alcance."))
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ actionId: "capa-ajena", file: new File([PDF_BYTES], "acta.pdf") }))
    expect(res.status).toBe(404)
    expect(mockAssertUpload).toHaveBeenCalledWith({
      actionId: "capa-ajena",
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: session.user.permissions,
    })
    expect(mockWriteBuffer).not.toHaveBeenCalled()
  })

  it("exige la acción a la que pertenece la evidencia", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ file: new File([PDF_BYTES], "acta.pdf") }))
    expect(res.status).toBe(400)
    expect(mockWriteBuffer).not.toHaveBeenCalled()
  })

  it("guarda el archivo y devuelve una ruta y un checksum que el contrato de evidencia acepta", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ actionId: "capa-1", file: new File([PDF_BYTES], "acta.pdf") }))
    expect(res.status).toBe(201)
    const body = await res.json() as { path: string; checksumSha256: string }
    expect(body.path).toMatch(/^storage\/capa-evidence\/[A-Za-z0-9._-]+$/)
    const { checkEvidence } = await import("@/lib/validation/evidence-contract")
    expect(checkEvidence({ kind: "document", reference: body.path, checksumSha256: body.checksumSha256 })).toEqual([])
  })
})
