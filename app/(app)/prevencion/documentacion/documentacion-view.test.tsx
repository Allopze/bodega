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
  createAndUploadSstDocumentAction,
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
  it("renders folders, documents, breadcrumbs, and context actions", () => {
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
    expect(screen.getByText("Documentación")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Papelera" })).toHaveAttribute("href", "/prevencion/documentacion/papelera")
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

    expect(screen.getByRole("menu", { name: /Acciones contextuales/i })).toBeInTheDocument()
    expect(screen.getByRole("menu", { name: /Acciones contextuales/i })).toHaveStyle({ left: "140px", top: "220px" })
    expect(screen.getByRole("menuitem", { name: "Renombrar carpeta" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Mover carpeta" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Archivar carpeta" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: /Acciones contextuales/i })).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Renombrar carpeta" }))
    fireEvent.change(screen.getByLabelText("Nombre de carpeta"), { target: { value: "Protocolos actualizados" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }))
    await waitFor(() => expect(renameSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1", name: "Protocolos actualizados" }))

    fireEvent.contextMenu(firstFolderLink())
    fireEvent.click(screen.getByRole("menuitem", { name: "Mover carpeta" }))
    fireEvent.click(screen.getByRole("button", { name: "Mover carpeta a destino" }))
    await waitFor(() => expect(moveSstDocumentFolderAction).toHaveBeenCalledWith({ id: "sdf-1", parentId: null }))

    fireEvent.contextMenu(firstFolderLink())
    fireEvent.click(screen.getByRole("menuitem", { name: "Archivar carpeta" }))
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

  it("shows a contextual dropzone for files dropped in the current folder", async () => {
    vi.mocked(createAndUploadSstDocumentAction).mockResolvedValue({ ok: true, data: { id: "sdoc-new" } })
    render(
      <DocumentacionView
        counters={counters}
        expiring={[]}
        documents={[]}
        folders={[]}
        breadcrumbs={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]}
        currentFolderId="sdf-1"
        categories={[{ slug: "gestion_preventiva", name: "Gestión preventiva", description: null, sortOrder: 1 }]}
        types={[]}
        searchParams={{}}
        total={0}
        canManage
        canApprove
        canAck
        canArchive
      />,
    )

    fireEvent.drop(screen.getByLabelText("Zona para subir documentos"), {
      dataTransfer: { files: [new File(["pdf"], "procedimiento.pdf", { type: "application/pdf" })] },
    })

    expect(screen.getByText("1 archivo listo para registrar")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Crear documento con este archivo" })).toHaveAttribute("href", "/prevencion/documentacion/nuevo?folder=sdf-1")

    fireEvent.click(screen.getByRole("button", { name: "Registrar y subir archivo directo" }))
    expect(screen.getByLabelText("Título rápido")).toHaveValue("procedimiento")
    fireEvent.click(screen.getByRole("button", { name: "Crear documento y subir archivo" }))
    await waitFor(() => expect(createAndUploadSstDocumentAction).toHaveBeenCalled())
    const formData = vi.mocked(createAndUploadSstDocumentAction).mock.calls[0]?.[0] as FormData
    expect(formData.get("folderId")).toBe("sdf-1")
    expect(formData.get("categorySlug")).toBe("gestion_preventiva")
    expect(formData.get("file")).toBeInstanceOf(File)
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
