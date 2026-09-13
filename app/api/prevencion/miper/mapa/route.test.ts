import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockGenerateStorageName = vi.hoisted(() => vi.fn())
const mockValidateFileBuffer = vi.hoisted(() => vi.fn())
const mockMkdirp = vi.hoisted(() => vi.fn())
const mockWriteBuffer = vi.hoisted(() => vi.fn())
const mockRemoveFile = vi.hoisted(() => vi.fn())
const mockResolveRiskMapDir = vi.hoisted(() => vi.fn())
const mockCreateRiskMapPath = vi.hoisted(() => vi.fn())
const mockUploadRiskMapLayout = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("@/lib/services/prevention-documents/utils", () => ({ generateStorageName: mockGenerateStorageName }))
vi.mock("@/lib/file-validation", () => ({
  MimeType: { IMAGE: new Set(["image/jpeg", "image/png"]) },
  validateFileBuffer: mockValidateFileBuffer,
}))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: mockMkdirp,
  writeBuffer: mockWriteBuffer,
  removeFile: mockRemoveFile,
}))
vi.mock("@/lib/storage/config", () => ({
  resolveRiskMapDir: mockResolveRiskMapDir,
  createRiskMapPath: mockCreateRiskMapPath,
  // Refleja el helper real: la ruta absoluta ya no se arma con `path.join` en la ruta,
  // sino en lib/storage, que es donde vive el `turbopackIgnore`.
  resolveStorageFile: (dir: string, name: string) => `${dir}/${name}`,
}))
vi.mock("@/lib/services/prevention-risk-map", () => ({ uploadRiskMapLayout: mockUploadRiskMapLayout }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))
vi.mock("@/lib/logger", () => ({ logger: { error: mockLoggerError } }))

function request(file: File, title = "Planta principal") {
  const form = new FormData()
  form.set("file", file)
  form.set("worksiteId", "ws-1")
  form.set("title", title)
  return new Request("http://localhost/api/prevencion/miper/mapa", { method: "POST", body: form })
}

describe("POST /api/prevencion/miper/mapa", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({
      session: { user: { id: "user-1", permissions: ["prevention:risk:edit"] } },
    })
    mockResolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-1"] })
    mockValidateFileBuffer.mockReturnValue({ mimeType: "image/png" })
    mockGenerateStorageName.mockReturnValue("stored-map.png")
    mockResolveRiskMapDir.mockReturnValue("/storage/risk-map")
    mockCreateRiskMapPath.mockReturnValue("storage/risk-map/stored-map.png")
    mockUploadRiskMapLayout.mockResolvedValue({ id: "layout-1" })
    mockRemoveFile.mockResolvedValue(undefined)
  })

  it("registra el plano en la misma operación con el MIME detectado por bytes", async () => {
    const spoofedFile = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "plano.jpg",
      { type: "image/jpeg" },
    )
    const { POST } = await import("./route")

    const response = await POST(request(spoofedFile))

    expect(response.status).toBe(201)
    expect(mockGenerateStorageName).toHaveBeenCalledWith("risk-map.png")
    expect(mockWriteBuffer).toHaveBeenCalledWith(
      path.join("/storage/risk-map", "stored-map.png"),
      expect.any(Buffer),
    )
    expect(mockUploadRiskMapLayout).toHaveBeenCalledWith({
      worksiteId: "ws-1",
      title: "Planta principal",
      imagePath: "storage/risk-map/stored-map.png",
      imageMimeType: "image/png",
    }, {
      userId: "user-1",
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:risk:edit"],
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/miper")
  })

  it("elimina el archivo escrito cuando falla el registro en base", async () => {
    mockUploadRiskMapLayout.mockRejectedValue(new Error("DB unavailable"))
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "plano.png",
      { type: "image/png" },
    )
    const { POST } = await import("./route")

    const response = await POST(request(file))

    expect(response.status).toBe(400)
    expect(mockRemoveFile).toHaveBeenCalledWith(path.join("/storage/risk-map", "stored-map.png"))
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})
