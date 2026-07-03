// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentacionHeaderActions } from "./documentacion-header-actions"
import { createSstDocumentFolderAction } from "./actions"

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
})
