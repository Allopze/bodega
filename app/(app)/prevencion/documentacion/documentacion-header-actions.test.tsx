// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentacionHeaderActions } from "./documentacion-header-actions"
import { uploadFilesAsDocuments } from "./documentacion-upload"
import { createAndUploadSstDocumentAction, createSstDocumentFolderAction } from "./actions"

const refresh = vi.fn()

Element.prototype.scrollIntoView = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock("./actions", () => ({
  createSstDocumentFolderAction: vi.fn(),
  createAndUploadSstDocumentAction: vi.fn(),
  uploadTypedSstDocumentAction: vi.fn(),
  listSstDocumentsOfTypeAction: vi.fn(async () => ({ ok: true, data: { documents: [] } })),
  previewSstDocumentUploadEffectsAction: vi.fn(async () => ({ ok: true, data: { effects: null } })),
}))

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const baseProps = {
  currentFolderId: "sdf-parent",
  folderWorksiteId: null,
  documentTypes: [{
    id: "sstdt-legal_normativa-riohs-seremi",
    name: "Carta conductora del RIOHS a la SEREMI de Salud",
    code: "RIOHS-SEREMI",
    categoryName: "Legal y normativa",
    requiresApproval: false,
    defaultValidityMonths: null,
  }],
  worksites: [{ id: "ws-1", name: "Faena Norte" }],
  canUploadCorporate: true,
}

function openBulkUpload() {
  fireEvent.click(screen.getByRole("button", { name: /Subir documento/i }))
  fireEvent.click(screen.getByRole("button", { name: "Carga masiva (sin clasificar)" }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DocumentacionHeaderActions", () => {
  it("renders document actions in the header and creates a folder in the current folder", async () => {
    vi.mocked(createSstDocumentFolderAction).mockResolvedValue({ ok: true, data: { id: "sdf-new" } })

    render(<DocumentacionHeaderActions {...baseProps} />)

    expect(screen.getByRole("link", { name: "Papelera" })).toHaveAttribute("href", "/prevencion/documentacion/papelera")

    fireEvent.click(screen.getByRole("button", { name: /Nueva carpeta/i }))
    fireEvent.change(screen.getByPlaceholderText("Nombre de carpeta"), { target: { value: "Protocolos" } })
    fireEvent.click(screen.getByRole("button", { name: "Crear carpeta" }))

    await waitFor(() => expect(createSstDocumentFolderAction).toHaveBeenCalledWith({ name: "Protocolos", parentId: "sdf-parent" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nueva carpeta" })).not.toBeInTheDocument())
    expect(refresh).toHaveBeenCalled()
  })

  it("asks what the document is before accepting a file: the typed upload is the default", () => {
    render(<DocumentacionHeaderActions {...baseProps} />)

    fireEvent.click(screen.getByRole("button", { name: /Subir documento/i }))

    expect(screen.getByRole("button", { name: "Documento clasificado" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Tipo de documento")).toBeInTheDocument()
    // Sin tipo ni archivo no hay nada que cargar.
    expect(screen.getByRole("button", { name: "Cargar documento" })).toBeDisabled()
  })

  it("keeps the bulk upload (files or folders) as an explicit unclassified mode", () => {
    render(<DocumentacionHeaderActions {...baseProps} />)

    // "Subir documento" no es un link a /nuevo, es un botón que abre el modal.
    expect(screen.queryByRole("link", { name: /Subir documento/i })).not.toBeInTheDocument()
    openBulkUpload()

    expect(screen.getByRole("button", { name: "Subir archivos" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Subir carpeta" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Subir archivos" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "Clasificación del documento" })).toBeInTheDocument()
  })

  it("ignores a second upload trigger while the first batch is still running", async () => {
    let resolveUpload: (value: { ok: true }) => void = () => {}
    vi.mocked(createAndUploadSstDocumentAction).mockImplementation(
      () => new Promise((resolve) => {
        resolveUpload = resolve
      }),
    )

    render(<DocumentacionHeaderActions {...baseProps} />)

    openBulkUpload()
    fireEvent.click(screen.getByRole("combobox", { name: "Clasificación del documento" }))
    fireEvent.click(await screen.findByRole("option", { name: "Operacional" }))
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement
    const file = new File(["contenido"], "procedimiento.pdf", { type: "application/pdf" })

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(createAndUploadSstDocumentAction).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { files: [file] } })
    expect(createAndUploadSstDocumentAction).toHaveBeenCalledTimes(1)
    resolveUpload({ ok: true })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("preserves nested folder structure when uploading a folder", async () => {
    vi.mocked(createSstDocumentFolderAction)
      .mockResolvedValueOnce({ ok: true, data: { id: "sdf-root-folder" } })
      .mockResolvedValueOnce({ ok: true, data: { id: "sdf-child-folder" } })
    vi.mocked(createAndUploadSstDocumentAction).mockResolvedValue({ ok: true })

    const file = new File(["contenido"], "procedimiento.pdf", { type: "application/pdf" })
    Object.defineProperty(file, "webkitRelativePath", {
      value: "Protocolos/Subcarpeta/procedimiento.pdf",
    })

    await uploadFilesAsDocuments([file], "sdf-current", "sensitive_preventive", vi.fn())

    expect(createSstDocumentFolderAction).toHaveBeenNthCalledWith(1, { name: "Protocolos", parentId: "sdf-current" })
    expect(createSstDocumentFolderAction).toHaveBeenNthCalledWith(2, { name: "Subcarpeta", parentId: "sdf-root-folder" })
    const formData = vi.mocked(createAndUploadSstDocumentAction).mock.calls[0]?.[0] as FormData
    expect(formData.get("folderId")).toBe("sdf-child-folder")
    expect(formData.get("title")).toBe("procedimiento")
    expect(formData.get("dataClass")).toBe("sensitive_preventive")
  })

  it("does not upload a file into the wrong folder when creating a nested folder fails", async () => {
    vi.mocked(createSstDocumentFolderAction).mockResolvedValue({ ok: false, message: "No se pudo crear carpeta" })
    vi.mocked(createAndUploadSstDocumentAction).mockResolvedValue({ ok: true })
    const onProgress = vi.fn()

    const file = new File(["contenido"], "procedimiento.pdf", { type: "application/pdf" })
    Object.defineProperty(file, "webkitRelativePath", {
      value: "Protocolos/procedimiento.pdf",
    })

    await uploadFilesAsDocuments([file], "sdf-current", "operational", onProgress)

    expect(createAndUploadSstDocumentAction).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})
