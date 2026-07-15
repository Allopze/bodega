import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockAssertWorksiteAccess = vi.hoisted(() => vi.fn())
const mockMkdirp = vi.hoisted(() => vi.fn())
const mockWriteBuffer = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  guardPermission: mockGuardPermission,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  assertWorksiteAccess: mockAssertWorksiteAccess,
}))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: mockMkdirp,
  writeBuffer: mockWriteBuffer,
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

const session = { user: { id: "user-1", permissions: ["prevention:pdtp:execute"] } }

// Minimal valid magic-byte buffers per lib/file-validation.ts
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TEXT_BYTES = new Uint8Array(Buffer.from("just some plain text, not a real file"))

function makeRequest(fields: { file?: File; worksiteId?: string }) {
  const form = new FormData()
  if (fields.file) form.set("file", fields.file)
  if (fields.worksiteId !== undefined) form.set("worksiteId", fields.worksiteId)
  return { formData: async () => form } as unknown as Request
}

describe("POST /api/prevencion/pdtp/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockAssertWorksiteAccess.mockReturnValue(undefined)
    mockMkdirp.mockResolvedValue(undefined)
    mockWriteBuffer.mockResolvedValue(undefined)
  })

  it("returns 403 when permission guard fails", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const { POST } = await import("./route")
    const file = new File([PDF_BYTES], "foto.pdf", { type: "application/pdf" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 when no file is provided", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ worksiteId: "ws-1" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when worksiteId is missing", async () => {
    const { POST } = await import("./route")
    const file = new File([PDF_BYTES], "foto.pdf", { type: "application/pdf" })
    const res = await POST(makeRequest({ file }))
    expect(res.status).toBe(400)
  })

  it("returns 403 when the user has no access to the worksite", async () => {
    mockAssertWorksiteAccess.mockImplementationOnce(() => {
      throw new Error("Actividad PDTP no encontrada o sin acceso a la faena.")
    })
    const { POST } = await import("./route")
    const file = new File([PDF_BYTES], "foto.pdf", { type: "application/pdf" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-2" }))
    expect(res.status).toBe(403)
  })

  it("rejects a too-large file", async () => {
    const { POST } = await import("./route")
    const big = new Uint8Array(25 * 1024 * 1024 + 1)
    big.set(PDF_BYTES)
    const file = new File([big], "grande.pdf", { type: "application/pdf" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/25 MB/)
  })

  it("rejects an empty file", async () => {
    const { POST } = await import("./route")
    const file = new File([], "vacio.pdf", { type: "application/pdf" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    expect(res.status).toBe(400)
  })

  it("rejects a disallowed MIME type (magic bytes don't match pdf/jpeg/png)", async () => {
    const { POST } = await import("./route")
    const file = new File([TEXT_BYTES], "notas.txt", { type: "text/plain" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
  })

  it("accepts a valid PDF and returns a path under storage/pdtp-evidence/", async () => {
    const { POST } = await import("./route")
    const file = new File([PDF_BYTES], "foto.pdf", { type: "application/pdf" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.path).toMatch(/^storage\/pdtp-evidence\/.+\.pdf$/)
    expect(mockWriteBuffer).toHaveBeenCalledTimes(1)
  })

  it("accepts a valid JPEG and returns a path under storage/pdtp-evidence/", async () => {
    const { POST } = await import("./route")
    const file = new File([JPEG_BYTES], "foto.jpg", { type: "image/jpeg" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.path).toMatch(/^storage\/pdtp-evidence\/.+\.jpg$/)
  })

  it("accepts a valid PNG and returns a path under storage/pdtp-evidence/", async () => {
    const { POST } = await import("./route")
    const file = new File([PNG_BYTES], "foto.png", { type: "image/png" })
    const res = await POST(makeRequest({ file, worksiteId: "ws-1" }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.path).toMatch(/^storage\/pdtp-evidence\/.+\.png$/)
  })
})
