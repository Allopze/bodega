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
const mockSubmitDocumentVersionForReview = vi.hoisted(() => vi.fn(async () => undefined))
const mockReturnObservedDocumentVersionToDraft = vi.hoisted(() => vi.fn(async () => undefined))
const mockMarkDocumentVersionReviewed = vi.hoisted(() => vi.fn(async () => undefined))
const mockObserveDocumentVersion = vi.hoisted(() => vi.fn(async () => undefined))
const mockApproveDocumentVersion = vi.hoisted(() => vi.fn(async () => undefined))
const mockPublishDocumentVersion = vi.hoisted(() => vi.fn(async () => undefined))
const mockAcknowledgeDocumentVersion = vi.hoisted(() => vi.fn(async () => undefined))
const mockAssignDocumentVersionRecipients = vi.hoisted(() => vi.fn(async () => [{ id: "target-1" }]))
const mockExemptDocumentDistributionTarget = vi.hoisted(() => vi.fn(async () => undefined))
const mockListDocumentRecipientOptions = vi.hoisted(() => vi.fn(async () => []))
const mockGetDocumentBundle = vi.hoisted(() => vi.fn(async (): Promise<{
  doc: { id: string; uploadedBy: string; worksiteId: string | null }
  versions: Array<{ uploadedBy: string }>
  distribution: Array<{ userId: string | null; assignedByUserId: string; exemptedByUserId: string | null }>
} | null> => ({
  doc: { id: "doc-1", uploadedBy: "user-1", worksiteId: null },
  versions: [],
  distribution: [],
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
  submitDocumentVersionForReview: mockSubmitDocumentVersionForReview,
  returnObservedDocumentVersionToDraft: mockReturnObservedDocumentVersionToDraft,
  markDocumentVersionReviewed: mockMarkDocumentVersionReviewed,
  observeDocumentVersion: mockObserveDocumentVersion,
  approveDocumentVersion: mockApproveDocumentVersion,
  publishDocumentVersion: mockPublishDocumentVersion,
  acknowledgeDocumentVersion: mockAcknowledgeDocumentVersion,
  assignDocumentVersionRecipients: mockAssignDocumentVersionRecipients,
  exemptDocumentDistributionTarget: mockExemptDocumentDistributionTarget,
  listDocumentRecipientOptions: mockListDocumentRecipientOptions,
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
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
  submitSstDocumentVersionForReviewAction,
  observeSstDocumentVersionAction,
  approveSstDocumentVersionAction,
  publishSstDocumentVersionAction,
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
    fd.set("dataClass", "operational")
    const res = await createAndUploadSstDocumentAction(fd)
    expect(mockListDocumentCategories).toHaveBeenCalled()
    expect(res.ok).toBe(true)
  })

  it("crea documento y sube versión cuando los datos son válidos", async () => {
    const fd = new FormData()
    fd.set("categorySlug", "gestion_preventiva")
    fd.set("title", "Reglamento interno")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))
    fd.set("dataClass", "operational")
    const res = await createAndUploadSstDocumentAction(fd)
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ id: "doc-1" })
    expect(mockCreateDocument).toHaveBeenCalled()
    expect(mockUploadDocumentVersion).toHaveBeenCalled()
  })

  it("archiva el borrador si falla la carga de su primera versión", async () => {
    mockUploadDocumentVersion.mockRejectedValueOnce(new Error("Archivo inválido"))
    const fd = new FormData()
    fd.set("categorySlug", "gestion_preventiva")
    fd.set("title", "Reglamento interno")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))
    fd.set("dataClass", "operational")

    const res = await createAndUploadSstDocumentAction(fd)

    expect(res.ok).toBe(false)
    expect(mockArchiveDocument).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ documentId: "doc-1" }),
    }))
  })

  it("retorna error si el título está vacío", async () => {
    const fd = new FormData()
    fd.set("categorySlug", "gestion_preventiva")
    fd.set("title", "")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))
    fd.set("dataClass", "operational")
    const res = await createAndUploadSstDocumentAction(fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors).toBeDefined()
  })

  it("rechaza una carga sin clasificación explícita", async () => {
    const fd = new FormData()
    fd.set("categorySlug", "gestion_preventiva")
    fd.set("title", "Reglamento interno")
    fd.set("file", new File(["contenido"], "reglamento.pdf", { type: "application/pdf" }))

    const res = await createAndUploadSstDocumentAction(fd)

    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/clasificación/i)
    expect(mockCreateDocument).not.toHaveBeenCalled()
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

describe("document workflow actions", () => {
  const input = { documentId: "doc-1", versionId: "ver-1" }

  it("uses the dedicated permission when submitting for review", async () => {
    const result = await submitSstDocumentVersionForReviewAction(input)

    expect(result.ok).toBe(true)
    expect(mockGuardPermission).toHaveBeenCalledWith("prevention:docs:submit_review")
    expect(mockSubmitDocumentVersionForReview).toHaveBeenCalledWith(expect.objectContaining({
      versionId: "ver-1",
      permissions: expect.any(Array),
    }))
  })

  it("requires a reviewer permission to observe and forwards the evidence comment", async () => {
    const result = await observeSstDocumentVersionAction({ ...input, comment: "Falta control operacional" })

    expect(result.ok).toBe(true)
    expect(mockGuardPermission).toHaveBeenCalledWith("prevention:docs:review")
    expect(mockObserveDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({
      comment: "Falta control operacional",
    }))
  })

  it("keeps approval and publication as separate permissions and operations", async () => {
    await approveSstDocumentVersionAction(input)
    await publishSstDocumentVersionAction(input)

    expect(mockGuardPermission).toHaveBeenNthCalledWith(1, "prevention:docs:approve")
    expect(mockGuardPermission).toHaveBeenNthCalledWith(2, "prevention:docs:publish")
    expect(mockApproveDocumentVersion).toHaveBeenCalledOnce()
    expect(mockPublishDocumentVersion).toHaveBeenCalledOnce()
  })

  it("does not call the workflow service when permission is denied", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })

    const result = await publishSstDocumentVersionAction(input)

    expect(result.ok).toBe(false)
    expect(mockPublishDocumentVersion).not.toHaveBeenCalled()
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

/**
 * Fase 0 (baseline): fija el contrato público de exports de este módulo antes
 * del split de Fase 2 (H-25), que convertirá `actions.ts` en un directorio
 * `actions/` con `index.ts` como barrel. Este test importa por el mismo
 * specifier que usa el resto de la app (`@/app/(app)/prevencion/documentacion/actions`),
 * así que sigue funcionando sin cambios cuando ese specifier resuelva a
 * `actions/index.ts` en lugar de `actions.ts` — a diferencia de
 * `lib/__tests__/prevention-documentation-canonical.test.ts`, que lee el
 * archivo con `readFileSync("actions.ts")` y se rompería con el split.
 */
describe("documentacion/actions.ts — contrato público de exports (Fase 0 baseline)", () => {
  it("expone exactamente los 30 exports nombrados usados hoy por la app y los tests", async () => {
    const mod: Record<string, unknown> = await import("@/app/(app)/prevencion/documentacion/actions")

    const expectedExportNames = [
      "createAndUploadSstDocumentAction",
      "uploadSstDocumentVersionAction",
      "archiveSstDocumentAction",
      "restoreSstDocumentAction",
      "submitSstDocumentVersionForReviewAction",
      "returnObservedSstDocumentVersionToDraftAction",
      "markSstDocumentVersionReviewedAction",
      "observeSstDocumentVersionAction",
      "approveSstDocumentVersionAction",
      "publishSstDocumentVersionAction",
      "assignSstDocumentRecipientsAction",
      "acknowledgeSstDocumentVersionAction",
      "exemptSstDocumentRecipientAction",
      "createSstDocumentLinkAction",
      "removeSstDocumentLinkAction",
      "regularizeSstDocumentIntegrityAction",
      "createSstDocumentFolderAction",
      "renameSstDocumentFolderAction",
      "moveSstDocumentFolderAction",
      "archiveSstDocumentFolderAction",
      "restoreSstDocumentFolderAction",
      "moveSstDocumentAction",
      "revalidateBiblioteca",
      "getDocumentDetailAction",
      // Subida tipada y entrega del RIOHS a la dotación (2026-09-24).
      "uploadTypedSstDocumentAction",
      "previewSstDocumentUploadEffectsAction",
      "listSstDocumentsOfTypeAction",
      "classifySstDocumentAction",
      "exemptSstDocumentRecipientsAction",
      "assignSstDocumentToWorkforceAction",
    ]

    for (const name of expectedExportNames) {
      expect(mod, `falta el export "${name}"`).toHaveProperty(name)
      expect(typeof mod[name], `"${name}" debería seguir siendo una función`).toBe("function")
    }

    // Comparación exhaustiva: si aparece un export nuevo o desaparece uno
    // existente, este test debe fallar y forzar revisión explícita de la lista
    // (protege contra "export *" accidentales al hacer el split de Fase 2).
    expect(Object.keys(mod).sort()).toEqual([...expectedExportNames].sort())
  })
})
