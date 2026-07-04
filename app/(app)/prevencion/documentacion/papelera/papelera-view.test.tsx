// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PapeleraView } from "./papelera-view"
import type { ActionState } from "@/lib/validation/masters"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("../actions", () => ({
  restoreSstDocumentAction: vi.fn(),
  restoreSstDocumentFolderAction: vi.fn(),
}))

import { restoreSstDocumentAction, restoreSstDocumentFolderAction } from "../actions"

afterEach(() => cleanup())

const FOLDER = {
  id: "sdf-1",
  parentId: null,
  name: "Protocolos",
  worksiteName: "Faena Norte",
  archivedAt: "2026-07-02T10:00:00.000Z",
  updatedAt: "2026-07-02T10:00:00.000Z",
}
const DOCUMENT = {
  id: "sdoc-1",
  title: "Procedimiento seguro",
  internalCode: "PTS-001",
  worksiteName: "Faena Norte",
  fileName: "procedimiento.pdf",
  mimeType: "application/pdf",
  updatedAt: "2026-07-03T10:00:00.000Z",
}

describe("PapeleraView", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(restoreSstDocumentAction).mockReset()
    vi.mocked(restoreSstDocumentFolderAction).mockReset()
  })

  it("renders archived folders and files with a view-mode toggle, no governance columns", () => {
    render(
      <PapeleraView
        canRestore
        userId="test-user"
        folders={[FOLDER]}
        documents={[DOCUMENT]}
      />,
    )

    expect(screen.getByRole("group", { name: "Cambiar modo de vista" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Restaurar carpeta Protocolos" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Restaurar documento Procedimiento seguro" })).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Faena" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Estado" })).not.toBeInTheDocument()
  })

  it("lets the user switch to grid view and restore via the action button", async () => {
    vi.mocked(restoreSstDocumentAction).mockResolvedValue({ ok: true } as ActionState)
    vi.mocked(restoreSstDocumentFolderAction).mockResolvedValue({ ok: true } as ActionState)

    render(
      <PapeleraView
        canRestore
        userId="papelera-user"
        folders={[FOLDER]}
        documents={[DOCUMENT]}
      />,
    )

    // Switch to grid view.
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a vista de cuadrícula" }))
    expect(screen.queryByRole("button", { name: "Restaurar carpeta Protocolos" })).not.toBeInTheDocument()

    // In grid mode the per-item Restaurar button is gone; the action button
    // (3-dot) on the tile triggers restore. Hover the tile to make it appear.
    const folderTile = screen.getByLabelText("Carpeta Protocolos")
    fireEvent.mouseEnter(folderTile)
    fireEvent.click(screen.getByRole("button", { name: "Acciones de Protocolos" }))
    await waitFor(() => expect(restoreSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1" }))

    const documentTile = screen.getByLabelText("Documento Procedimiento seguro")
    fireEvent.mouseEnter(documentTile)
    fireEvent.click(screen.getByRole("button", { name: "Acciones de Procedimiento seguro" }))
    await waitFor(() => expect(restoreSstDocumentAction).toHaveBeenCalledWith({ documentId: "sdoc-1" }))

    // The view-mode preference was persisted to localStorage under the user key.
    expect(window.localStorage.getItem("sst.documents.viewMode.papelera-user")).toBe("grid")
  })
})
