// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentacionView } from "./documentacion-view"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

function firstFolderLink() {
  const link = screen.getAllByRole("link", { name: /Protocolos MINSAL/i })[0]
  if (!link) throw new Error("Expected Protocolos MINSAL link")
  return link
}

describe("DocumentacionView", () => {
  it("renders as a plain file library without governance columns or state filters", () => {
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[{
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
        }]}
        folders={[{
          id: "sdf-1",
          parentId: null,
          name: "Protocolos MINSAL",
          worksiteId: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        folderOptions={[]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        searchParams={{}}
        total={2}
        canManage
        canArchive
      />,
    )

    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Tipo" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Actualizado" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Tamaño" })).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Estado" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Faena" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Responsable" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Vence" })).not.toBeInTheDocument()
    expect(screen.queryByText("En revisión")).not.toBeInTheDocument()
    expect(screen.queryByText("Vencidos")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Filtrar" })).not.toBeInTheDocument()
  })

  it("renders folders, documents, and context actions", () => {
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[{
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
          expiresAt: null,
          daysUntilExpiry: null,
          currentVersionId: "sdv-1",
          requiresAcknowledgment: false,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        folders={[{
          id: "sdf-1",
          parentId: null,
          name: "Protocolos MINSAL",
          worksiteId: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        breadcrumbs={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Documentación" },
        ]}
        categories={[{ slug: "gestion_preventiva", name: "Gestión preventiva", description: null, sortOrder: 1 }]}
        types={[]}
        searchParams={{}}
        total={1}
        canManage
        canApprove
        canAck
        canArchive
      />,
    )

    expect(screen.getByRole("link", { name: /Protocolos MINSAL/i })).toHaveAttribute("href", "/prevencion/documentacion?folder=sdf-1")
    expect(screen.getByRole("link", { name: /Procedimiento trabajo seguro/i })).toHaveAttribute("href", "/prevencion/documentacion/sdoc-1")
    expect(screen.getByRole("link", { name: /Descargar/i })).toHaveAttribute("href", "/api/prevencion/documentacion/sdoc-1?download=1")
    expect(screen.getAllByText(/Mover/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole("link", { name: "Papelera" })).not.toBeInTheDocument()
  })

  it("opens a context menu with right click actions for folders", () => {
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[]}
        folders={[{
          id: "sdf-1",
          parentId: null,
          name: "Protocolos MINSAL",
          worksiteId: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        folderOptions={[{ id: "sdf-2", parentId: null, name: "Procedimientos" }]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{}}
        total={0}
        canManage
        canApprove
        canAck
        canArchive
      />,
    )

    fireEvent.contextMenu(firstFolderLink(), { clientX: 140, clientY: 220 })

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
        folders={[{
          id: "sdf-1",
          parentId: null,
          name: "Protocolos MINSAL",
          worksiteId: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
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
        canApprove
        canAck
        canArchive
      />,
    )

    fireEvent.contextMenu(firstFolderLink())
    fireEvent.click(screen.getByRole("menuitem", { name: "Renombrar" }))
    fireEvent.change(screen.getByLabelText("Nombre de carpeta"), { target: { value: "Protocolos actualizados" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }))
    await waitFor(() => expect(renameSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1", name: "Protocolos actualizados" }))

    fireEvent.contextMenu(firstFolderLink())
    fireEvent.click(screen.getByRole("menuitem", { name: "Mover" }))
    fireEvent.click(screen.getByRole("button", { name: "Mover carpeta a destino" }))
    await waitFor(() => expect(moveSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1", parentId: null }))

    fireEvent.contextMenu(firstFolderLink())
    fireEvent.click(screen.getByRole("menuitem", { name: "Archivar" }))
    await waitFor(() => expect(archiveSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1" }))
  })

  it("supports multi-selection and bulk folder archive", async () => {
    vi.mocked(archiveSstDocumentFolderAction).mockResolvedValue({ ok: true })
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[{
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
          expiresAt: null,
          daysUntilExpiry: null,
          currentVersionId: "sdv-1",
          requiresAcknowledgment: false,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        folders={[{
          id: "sdf-1",
          parentId: null,
          name: "Protocolos MINSAL",
          worksiteId: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{}}
        total={1}
        canManage
        canApprove
        canAck
        canArchive
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
          {
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
            expiresAt: null,
            daysUntilExpiry: null,
            currentVersionId: "sdv-1",
            requiresAcknowledgment: false,
            updatedAt: "2026-07-02T00:00:00.000Z",
          },
          {
            id: "sdoc-2",
            title: "Matriz de riesgos",
            internalCode: "MAT-001",
            categorySlug: "gestion_preventiva",
            status: "borrador",
            confidentiality: "publico_interno",
            worksiteId: null,
            worksiteName: null,
            responsibleUserId: null,
            responsibleName: null,
            uploaderName: "Prevencionista",
            expiresAt: null,
            daysUntilExpiry: null,
            currentVersionId: null,
            requiresAcknowledgment: false,
            updatedAt: "2026-07-02T00:00:00.000Z",
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
        canApprove
        canAck
        canArchive
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
        folders={[{
          id: "sdf-archived",
          parentId: null,
          name: "Carpeta archivada",
          worksiteId: null,
          archivedAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        }]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        categories={[]}
        types={[]}
        searchParams={{ status: "archivado" }}
        total={0}
        canManage
        canApprove
        canAck
        canArchive
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Restaurar carpeta Carpeta archivada" }))
    await waitFor(() => expect(restoreSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-archived" }))
  })
})
