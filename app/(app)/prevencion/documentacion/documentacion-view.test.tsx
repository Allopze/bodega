// @vitest-environment jsdom

import * as React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider, useShellHeader } from "@/components/layout/header-context"
import { DocumentacionView } from "./documentacion-view"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("./actions", () => ({
  archiveSstDocumentAction: vi.fn(),
  createAndUploadSstDocumentAction: vi.fn(),
  createSstDocumentFolderAction: vi.fn(),
  moveSstDocumentAction: vi.fn(),
  renameSstDocumentFolderAction: vi.fn(),
  moveSstDocumentFolderAction: vi.fn(),
  archiveSstDocumentFolderAction: vi.fn(),
  restoreSstDocumentFolderAction: vi.fn(),
}))

import {
  archiveSstDocumentAction,
  archiveSstDocumentFolderAction,
  moveSstDocumentAction,
  moveSstDocumentFolderAction,
  renameSstDocumentFolderAction,
  restoreSstDocumentFolderAction,
} from "./actions"

afterEach(() => cleanup())

const counters = {
  total: 1,
  byStatus: {
    borrador: 0,
    en_revision: 0,
    observado: 0,
    aprobado: 0,
    vigente: 1,
    vencido: 0,
    reemplazado: 0,
    archivado: 0,
  },
  expiringSoon: { within7: 0, within15: 0, within30: 0 },
  pendingReview: 0,
  observed: 0,
  ackPending: 0,
}

function firstFolderTile() {
  // Both the primary trigger (Link in list / role="button" tile in grid) and
  // the selection checkbox carry a matching label, so we filter out the
  // <input> and keep the element that actually owns the contextmenu listener.
  const matches = screen.getAllByLabelText(/Carpeta Protocolos MINSAL/i)
  const trigger = matches.find((el) => el.tagName !== "INPUT")
  if (!trigger) throw new Error("Expected folder trigger (link or tile) to be present")
  return trigger
}

const FOLDER = {
  id: "sdf-1",
  parentId: null,
  name: "Protocolos MINSAL",
  worksiteId: null,
  updatedAt: "2026-07-02T00:00:00.000Z",
}

const DOCUMENT = {
  id: "sdoc-1",
  title: "Procedimiento trabajo seguro",
  internalCode: "PTS-001",
  categorySlug: "gestion_preventiva",
  status: "vigente",
  confidentiality: "publico_interno",
  worksiteId: "ws-1",
  worksiteName: "Faena Norte",
  responsibleUserId: null,
  responsibleName: null,
  uploaderName: "Prevencionista",
  expiresAt: "2026-08-01",
  daysUntilExpiry: 29,
  currentVersionId: "sdv-1",
  fileName: "procedimiento.pdf",
  mimeType: "application/pdf",
  fileSize: 2048,
  requiresAcknowledgment: false,
  updatedAt: "2026-07-02T00:00:00.000Z",
}

function HeaderSearchSetter({ value }: { value: string }) {
  const { setSearchQuery } = useShellHeader()

  React.useEffect(() => {
    setSearchQuery(value)
  }, [setSearchQuery, value])

  return null
}

function renderWithHeaderSearch(ui: React.ReactElement, value: string) {
  return render(
    <ShellHeaderProvider>
      <HeaderSearchSetter value={value} />
      {ui}
    </ShellHeaderProvider>,
  )
}

describe("DocumentacionView", () => {
  it("renders the document library with a view-mode toggle, no governance columns or state filters", () => {
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[DOCUMENT]}
        folders={[FOLDER]}
        folderOptions={[]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        searchParams={{}}
        total={2}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    expect(screen.getByRole("group", { name: "Cambiar modo de vista" })).toBeInTheDocument()
    // The folder/document are reachable by their aria-label in either view
    // (list renders a link, grid renders a button); the toggle is what
    // switches between them — see the next test for that interaction.
    expect(screen.getAllByLabelText(/Carpeta Protocolos MINSAL/i).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(/Documento Procedimiento trabajo seguro/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole("columnheader", { name: "Estado" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Faena" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Responsable" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Vence" })).not.toBeInTheDocument()
    expect(screen.queryByText("En revisión")).not.toBeInTheDocument()
    expect(screen.queryByText("Vencidos")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Filtrar" })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Buscar en documentación...")).not.toBeInTheDocument()
  })

  it("filters folders and documents with the shell header search", async () => {
    renderWithHeaderSearch(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[
          DOCUMENT,
          {
            ...DOCUMENT,
            id: "sdoc-2",
            title: "Matriz de riesgos",
            internalCode: "MAT-001",
            fileName: "matriz.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ]}
        folders={[FOLDER]}
        folderOptions={[]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        searchParams={{}}
        total={3}
        canManage
        canArchive
        userId="test-user"
      />,
      "matriz",
    )

    await waitFor(() => expect(screen.getAllByLabelText(/Documento Matriz de riesgos/i).length).toBeGreaterThan(0))
    expect(screen.queryAllByLabelText(/Carpeta Protocolos MINSAL/i)).toHaveLength(0)
    expect(screen.queryAllByLabelText(/Documento Procedimiento trabajo seguro/i)).toHaveLength(0)
  })

  it("lets the user switch between list and grid via the toggle", () => {
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[{ ...DOCUMENT, expiresAt: null, daysUntilExpiry: null, currentVersionId: null }]}
        folders={[FOLDER]}
        folderOptions={[]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        searchParams={{}}
        total={1}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    // First paint is "list" — the table headers are present and the folder appears as a row.
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Protocolos MINSAL/i }).length).toBeGreaterThan(0)

    // Switch to grid — columns disappear, the folder becomes a button tile.
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a vista de cuadrícula" }))
    expect(screen.queryByRole("columnheader", { name: "Nombre" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Carpeta Protocolos MINSAL/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Documento Procedimiento trabajo seguro/i })).toBeInTheDocument()

    // Back to list.
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a vista de lista" }))
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Carpeta Protocolos MINSAL/i })).not.toBeInTheDocument()
  })

  it("renders a context menu with right click for folders, regardless of view mode", () => {
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[]}
        folders={[FOLDER]}
        folderOptions={[{ id: "sdf-2", parentId: null, name: "Procedimientos" }]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{}}
        total={0}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    fireEvent.contextMenu(firstFolderTile(), { clientX: 140, clientY: 220 })

    expect(screen.getByRole("menu", { name: /Acciones/i })).toBeInTheDocument()
    expect(screen.getByRole("menu", { name: /Acciones/i })).toHaveStyle({ left: "140px", top: "220px" })
    expect(screen.getByRole("menuitem", { name: "Renombrar" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Mover" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Archivar" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: /Acciones/i })).not.toBeInTheDocument()
  })

  it("submits folder rename, move, and archive actions", async () => {
    vi.mocked(renameSstDocumentFolderAction).mockResolvedValue({ ok: true })
    vi.mocked(moveSstDocumentFolderAction).mockResolvedValue({ ok: true })
    vi.mocked(archiveSstDocumentFolderAction).mockResolvedValue({ ok: true })

    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[]}
        folders={[FOLDER]}
        folderOptions={[
          { id: "sdf-1", parentId: null, name: "Protocolos MINSAL" },
          { id: "sdf-2", parentId: null, name: "Procedimientos" },
        ]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{}}
        total={0}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    fireEvent.contextMenu(firstFolderTile())
    fireEvent.click(screen.getByRole("menuitem", { name: "Renombrar" }))
    fireEvent.change(screen.getByLabelText("Nombre de carpeta"), { target: { value: "Protocolos actualizados" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }))
    await waitFor(() => expect(renameSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1", name: "Protocolos actualizados" }))

    fireEvent.contextMenu(firstFolderTile())
    fireEvent.click(screen.getByRole("menuitem", { name: "Mover" }))
    fireEvent.click(screen.getByRole("button", { name: "Mover carpeta a destino" }))
    await waitFor(() => expect(moveSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1", parentId: null }))

    fireEvent.contextMenu(firstFolderTile())
    fireEvent.click(screen.getByRole("menuitem", { name: "Archivar" }))
    await waitFor(() => expect(archiveSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1" }))
  })

  it("supports multi-selection and bulk folder archive", async () => {
    vi.mocked(archiveSstDocumentFolderAction).mockResolvedValue({ ok: true })
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[{ ...DOCUMENT, expiresAt: null, daysUntilExpiry: null, currentVersionId: null }]}
        folders={[FOLDER]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{}}
        total={1}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    fireEvent.click(screen.getByLabelText("Seleccionar carpeta Protocolos MINSAL"))
    fireEvent.click(screen.getByLabelText("Seleccionar documento Procedimiento trabajo seguro"))

    expect(screen.getByText("2 seleccionados")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Archivar carpetas seleccionadas" }))
    await waitFor(() => expect(archiveSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1" }))
  })

  it("supports bulk document archive and move from the selection toolbar", async () => {
    vi.mocked(archiveSstDocumentAction).mockResolvedValue({ ok: true })
    vi.mocked(moveSstDocumentAction).mockResolvedValue({ ok: true })

    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[
          { ...DOCUMENT, expiresAt: null, daysUntilExpiry: null, currentVersionId: null },
          {
            ...DOCUMENT,
            id: "sdoc-2",
            title: "Matriz de riesgos",
            internalCode: "MAT-001",
            status: "borrador",
            worksiteId: null,
            worksiteName: null,
            currentVersionId: null,
            expiresAt: null,
            daysUntilExpiry: null,
            fileName: null,
            mimeType: null,
            fileSize: null,
          },
        ]}
        folders={[]}
        folderOptions={[{ id: "sdf-2", parentId: null, name: "Procedimientos" }]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{}}
        total={2}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    fireEvent.click(screen.getByLabelText("Seleccionar documento Procedimiento trabajo seguro"))
    fireEvent.click(screen.getByLabelText("Seleccionar documento Matriz de riesgos"))

    expect(screen.getByRole("link", { name: "Descargar documentos seleccionados" })).toHaveAttribute(
      "href",
      "/api/prevencion/documentacion/bulk-download?ids=sdoc-1%2Csdoc-2",
    )
    fireEvent.click(screen.getByRole("button", { name: "Mover documentos seleccionados" }))
    fireEvent.click(screen.getByRole("button", { name: "Mover documentos a destino" }))
    await waitFor(() => expect(moveSstDocumentAction).toHaveBeenCalledWith({ id: "sdoc-1", folderId: null }))
    expect(moveSstDocumentAction).toHaveBeenCalledWith({ id: "sdoc-2", folderId: null })

    fireEvent.click(screen.getByLabelText("Seleccionar documento Procedimiento trabajo seguro"))
    fireEvent.click(screen.getByLabelText("Seleccionar documento Matriz de riesgos"))
    fireEvent.click(screen.getByRole("button", { name: "Archivar documentos seleccionados" }))
    await waitFor(() => expect(archiveSstDocumentAction).toHaveBeenCalledWith({ documentId: "sdoc-1" }))
    expect(archiveSstDocumentAction).toHaveBeenCalledWith({ documentId: "sdoc-2" })
  })

  it("restores archived folders from the archived view", async () => {
    vi.mocked(restoreSstDocumentFolderAction).mockResolvedValue({ ok: true })

    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[]}
        folders={[{ ...FOLDER, id: "sdf-archived", name: "Carpeta archivada", archivedAt: "2026-07-02T00:00:00.000Z" }]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{ status: "archivado" }}
        total={0}
        canManage
        canArchive
        userId="test-user"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Restaurar carpeta Carpeta archivada" }))
    await waitFor(() => expect(restoreSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-archived" }))
  })
})
