// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentacionHeaderActions, uploadFilesAsDocuments } from "./documentacion-header-actions"
import { createAndUploadSstDocumentAction, createSstDocumentFolderAction } from "./actions"

const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock("./actions", () => ({
  createSstDocumentFolderAction: vi.fn(),
  createAndUploadSstDocumentAction: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DocumentacionHeaderActions", () => {
  it("renders document actions in the header and creates a folder in the current folder", async () => {
    vi.mocked(createSstDocumentFolderAction).mockResolvedValue({ ok: true, data: { id: "sdf-new" } })

    render(<DocumentacionHeaderActions currentFolderId="sdf-parent" />)

    expect(screen.getByRole("link", { name: "Papelera" })).toHaveAttribute("href", "/prevencion/documentacion/papelera")

    fireEvent.click(screen.getByRole("button", { name: /Nueva carpeta/i }))
    fireEvent.change(screen.getByPlaceholderText("Nombre de carpeta"), { target: { value: "Protocolos" } })
    fireEvent.click(screen.getByRole("button", { name: "Crear carpeta" }))

    await waitFor(() => expect(createSstDocumentFolderAction).toHaveBeenCalledWith({ name: "Protocolos", parentId: "sdf-parent" }))
    expect(refresh).toHaveBeenCalled()
  })

  it("opens an upload modal (files or folders) instead of navigating to a form page", () => {
    render(<DocumentacionHeaderActions currentFolderId="sdf-parent" />)

    // "Subir archivo" ya no es un link a /nuevo, es un botón que abre el modal.
    expect(screen.queryByRole("link", { name: /Subir archivo/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Subir archivo/i }))

    expect(screen.getByRole("button", { name: "Subir archivos" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Subir carpeta" })).toBeInTheDocument()
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

    await uploadFilesAsDocuments([file], "sdf-current", vi.fn())

    expect(createSstDocumentFolderAction).toHaveBeenNthCalledWith(1, { name: "Protocolos", parentId: "sdf-current" })
    expect(createSstDocumentFolderAction).toHaveBeenNthCalledWith(2, { name: "Subcarpeta", parentId: "sdf-root-folder" })
    const formData = vi.mocked(createAndUploadSstDocumentAction).mock.calls[0]?.[0] as FormData
    expect(formData.get("folderId")).toBe("sdf-child-folder")
    expect(formData.get("title")).toBe("procedimiento")
  })

  it("does not upload a file into the wrong folder when creating a nested folder fails", async () => {
    vi.mocked(createSstDocumentFolderAction).mockResolvedValue({ ok: false, message: "No se pudo crear carpeta" })
    vi.mocked(createAndUploadSstDocumentAction).mockResolvedValue({ ok: true })
    const onProgress = vi.fn()

    const file = new File(["contenido"], "procedimiento.pdf", { type: "application/pdf" })
    Object.defineProperty(file, "webkitRelativePath", {
      value: "Protocolos/procedimiento.pdf",
    })

    await uploadFilesAsDocuments([file], "sdf-current", onProgress)

    expect(createAndUploadSstDocumentAction).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})
