/**
 * Anexos RE-20: la IP de la bitácora debe salir de `trustedAuditIp`
 * (cf-connecting-ip), nunca de `x-forwarded-for`, que es entrada del cliente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockStore = vi.hoisted(() => vi.fn())
const mockRead = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("@/lib/services/prevention-incident-re20-attachments", () => ({
  storePreventionIncidentRe20Attachment: mockStore,
  getPreventionIncidentRe20Attachment: mockRead,
}))

const session = { user: { id: "user-1", permissions: ["prevention:incidents:investigate"], roles: [] } }
const HEADERS = { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "203.0.113.9", "user-agent": "vitest" }

describe("rutas de anexos RE-20", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
  })

  it("la subida audita la IP confiable y no x-forwarded-for", async () => {
    mockStore.mockResolvedValue({ attachmentId: "a1" })
    const form = new FormData()
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "acta.pdf", { type: "application/pdf" }))
    form.set("clientAttachmentId", "attachment-0001")
    form.set("expectedWorkspaceVersion", "0")
    form.set("purpose", "Investigación")
    const request = { formData: async () => form, headers: new Headers(HEADERS) } as unknown as Request
    const { POST } = await import("./route")
    const res = await POST(request, { params: Promise.resolve({ id: "inc-1" }) })
    expect(res.status).toBe(200)
    expect(mockStore.mock.calls[0]?.[0].access.ctx.ip).toBe("203.0.113.9")
  })

  it("la subida sin cabecera de proxy confiable no registra IP", async () => {
    mockStore.mockResolvedValue({ attachmentId: "a1" })
    const form = new FormData()
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "acta.pdf", { type: "application/pdf" }))
    const request = { formData: async () => form, headers: new Headers({ "x-forwarded-for": "6.6.6.6" }) } as unknown as Request
    const { POST } = await import("./route")
    await POST(request, { params: Promise.resolve({ id: "inc-1" }) })
    expect(mockStore.mock.calls[0]?.[0].access.ctx.ip).toBeUndefined()
  })

  it("la descarga audita la IP confiable", async () => {
    mockRead.mockResolvedValue({
      buffer: Buffer.from("x"), metadata: { fileName: "a.txt", mimeType: "text/plain", size: 1 }, checksumSha256: "0".repeat(64),
    })
    const request = new Request("http://localhost/api/x?purpose=Revision", { headers: HEADERS })
    const { GET } = await import("./[attachmentId]/route")
    const res = await GET(request, { params: Promise.resolve({ id: "inc-1", attachmentId: "attachment-0001" }) })
    expect(res.status).toBe(200)
    expect(mockRead.mock.calls[0]?.[0].access.ctx.ip).toBe("203.0.113.9")
  })
})
