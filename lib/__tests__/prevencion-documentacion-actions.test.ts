/**
 * Unit tests para Server Actions de app/(app)/prevencion/documentacion/actions.ts
 * (cobertura previa: 0%)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockRequireAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn(() => true))
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn(() => ({ mode: "all" as const, ids: [] })))

const mockCreateDocument = vi.hoisted(() => vi.fn(async () => ({ id: "doc-1" })))
const mockUploadDocumentVersion = vi.hoisted(() => vi.fn(async () => ({ id: "ver-1", version: 1 })))
const mockArchiveDocument = vi.hoisted(() => vi.fn(async () => undefined))
const mockRestoreDocument = vi.hoisted(() => vi.fn(async () => undefined))
const mockCreateDocumentFolder = vi.hoisted(() => vi.fn(async () => ({ id: "folder-1" })))
const mockRenameDocumentFolder = vi.hoisted(() => vi.fn(async () => undefined))
const mockMoveDocumentFolder = vi.hoisted(() => vi.fn(async () => undefined))
const mockArchiveDocumentFolder = vi.hoisted(() => vi.fn(async () => undefined))
const mockRestoreDocumentFolder = vi.hoisted(() => vi.fn(async () => undefined))
const mockMoveDocumentToFolder = vi.hoisted(() => vi.fn(async () => undefined))
const mockListDocumentCategories = vi.hoisted(() => vi.fn(async () => [{ slug: "gestion_preventiva", name: "Gestión preventiva" }]))
const mockGetDocumentBundle = vi.hoisted(() => vi.fn(async (): Promise<{
  doc: { id: string; uploadedBy: string; worksiteId: string | null }
  versions: Array<{ uploadedBy: string }>
} | null> => ({
  doc: { id: "doc-1", uploadedBy: "user-1", worksiteId: null },
  versions: [],
})))

vi.mock("@/lib/auth/can", () => ({
  guardPermission: mockGuardPermission,
  requireAuth: mockRequireAuth,
  can: mockCan,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/lib/services/prevention-documents-library", () => ({
  createDocument: mockCreateDocument,
  uploadDocumentVersion: mockUploadDocumentVersion,
  archiveDocument: mockArchiveDocument,
  restoreDocument: mockRestoreDocument,
  createDocumentFolder: mockCreateDocumentFolder,
  renameDocumentFolder: mockRenameDocumentFolder,
  moveDocumentFolder: mockMoveDocumentFolder,
  archiveDocumentFolder: mockArchiveDocumentFolder,
  restoreDocumentFolder: mockRestoreDocumentFolder,
  moveDocumentToFolder: mockMoveDocumentToFolder,
  listDocumentCategories: mockListDocumentCategories,
  getDocumentBundle: mockGetDocumentBundle,
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map()),
}))

import {
  createAndUploadSstDocumentAction,
  uploadSstDocumentVersionAction,
  archiveSstDocumentAction,
  restoreSstDocumentAction,
  createSstDocumentFolderAction,
  renameSstDocumentFolderAction,
  moveSstDocumentFolderAction,
  archiveSstDocumentFolderAction,
  restoreSstDocumentFolderAction,
  moveSstDocumentAction,
  getDocumentDetailAction,
} from "@/app/(app)/prevencion/documentacion/actions"

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"],
      permissions: ["prevention:docs:manage", "prevention:docs:archive", "prevention:docs:view"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
  mockRequireAuth.mockResolvedValue(makeSession())
  mockCan.mockReturnValue(true)
})

describe("createAndUploadSstDocumentAction", () => {
  it("rechaza sin permisos", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const fd = new FormData()
    const res = await createAndUploadSstDocumentAction(fd)
    expect(res.ok).toBe(false)
  })

  it("rechaza sin archivo", async () => {
    const fd = new FormData()
    fd.set("title", "Reglamento interno")
    const res = await createAndUploadSstDocumentAction(fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Selecciona un archivo")
  })

  it("cae en la primera categoría activa cuando no viene categorySlug", async () => {
    const fd = new FormData()
    fd.set("title", "Reglamento interno")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))
    const res = await createAndUploadSstDocumentAction(fd)
    expect(mockListDocumentCategories).toHaveBeenCalled()
    expect(res.ok).toBe(true)
  })

  it("crea documento y sube versión cuando los datos son válidos", async () => {
    const fd = new FormData()
    fd.set("categorySlug", "gestion_preventiva")
    fd.set("title", "Reglamento interno")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))
    const res = await createAndUploadSstDocumentAction(fd)
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ id: "doc-1" })
    expect(mockCreateDocument).toHaveBeenCalled()
    expect(mockUploadDocumentVersion).toHaveBeenCalled()
  })

  it("retorna error si el título está vacío", async () => {
    const fd = new FormData()
    fd.set("categorySlug", "gestion_preventiva")
    fd.set("title", "")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))
    const res = await createAndUploadSstDocumentAction(fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors).toBeDefined()
  })
})

describe("uploadSstDocumentVersionAction", () => {
  it("rechaza sin archivo o documentId", async () => {
    const fd = new FormData()
    const res = await uploadSstDocumentVersionAction(fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Falta el archivo o el documento")
  })

  it("sube nueva versión correctamente", async () => {
    const fd = new FormData()
    fd.set("documentId", "doc-1")
    fd.set("file", new File(["contenido"], "v2.pdf", { type: "application/pdf" }))
    const res = await uploadSstDocumentVersionAction(fd)
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ id: "ver-1" })
  })
})

describe("archiveSstDocumentAction", () => {
  it("rechaza sin permisos", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const res = await archiveSstDocumentAction({ documentId: "doc-1" })
    expect(res.ok).toBe(false)
  })

  it("archiva documento válido", async () => {
    const res = await archiveSstDocumentAction({ documentId: "doc-1", comment: "vencido" })
    expect(res.ok).toBe(true)
    expect(mockArchiveDocument).toHaveBeenCalled()
  })
})

describe("restoreSstDocumentAction", () => {
  it("rechaza sin documentId", async () => {
    const res = await restoreSstDocumentAction({ documentId: "" })
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Documento requerido")
  })

  it("restaura documento válido", async () => {
    const res = await restoreSstDocumentAction({ documentId: "doc-1" })
    expect(res.ok).toBe(true)
    expect(mockRestoreDocument).toHaveBeenCalled()
  })
})

describe("createSstDocumentFolderAction", () => {
  it("rechaza nombre vacío", async () => {
    const res = await createSstDocumentFolderAction({ name: "" })
    expect(res.ok).toBe(false)
  })

  it("crea carpeta válida", async () => {
    const res = await createSstDocumentFolderAction({ name: "Capacitaciones 2026" })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ id: "folder-1" })
  })
})

describe("renameSstDocumentFolderAction", () => {
  it("renombra carpeta válida", async () => {
    const res = await renameSstDocumentFolderAction({ id: "folder-1", name: "Nuevo nombre" })
    expect(res.ok).toBe(true)
    expect(mockRenameDocumentFolder).toHaveBeenCalled()
  })
})

describe("moveSstDocumentFolderAction", () => {
  it("mueve carpeta a nuevo padre", async () => {
    const res = await moveSstDocumentFolderAction({ id: "folder-1", parentId: "folder-parent" })
    expect(res.ok).toBe(true)
    expect(mockMoveDocumentFolder).toHaveBeenCalled()
  })
})

describe("archiveSstDocumentFolderAction / restoreSstDocumentFolderAction", () => {
  it("archiva carpeta", async () => {
    const res = await archiveSstDocumentFolderAction({ id: "folder-1" })
    expect(res.ok).toBe(true)
    expect(mockArchiveDocumentFolder).toHaveBeenCalled()
  })

  it("restaura carpeta", async () => {
    const res = await restoreSstDocumentFolderAction({ id: "folder-1" })
    expect(res.ok).toBe(true)
    expect(mockRestoreDocumentFolder).toHaveBeenCalled()
  })
})

describe("moveSstDocumentAction", () => {
  it("mueve documento a carpeta destino", async () => {
    const res = await moveSstDocumentAction({ id: "doc-1", folderId: "folder-1" })
    expect(res.ok).toBe(true)
    expect(mockMoveDocumentToFolder).toHaveBeenCalled()
  })
})

describe("getDocumentDetailAction", () => {
  it("retorna error si no autenticado", async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error("no session"))
    const res = await getDocumentDetailAction("doc-1")
    expect(res.error).toBe("No autenticado")
  })

  it("retorna error si sin permisos de vista", async () => {
    mockCan.mockReturnValueOnce(false)
    const res = await getDocumentDetailAction("doc-1")
    expect(res.error).toBe("Sin permisos")
  })

  it("retorna error si documento no existe", async () => {
    mockGetDocumentBundle.mockResolvedValueOnce(null)
    const res = await getDocumentDetailAction("doc-999")
    expect(res.error).toBe("Documento no encontrado")
  })

  it("retorna el bundle con permisos calculados", async () => {
    const res = await getDocumentDetailAction("doc-1")
    expect(res.error).toBeUndefined()
    expect(res.bundle).toBeDefined()
    expect(res.canManage).toBe(true)
    expect(res.canArchive).toBe(true)
  })
})
