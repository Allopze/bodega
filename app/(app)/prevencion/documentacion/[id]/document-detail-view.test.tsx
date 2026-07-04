// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentDetailView } from "./document-detail-view"
import type { DetailViewProps } from "./document-detail.helpers"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("../actions", () => ({
  restoreSstDocumentAction: vi.fn(),
  uploadSstDocumentVersionAction: vi.fn(),
  archiveSstDocumentAction: vi.fn(),
}))

afterEach(() => cleanup())

const baseProps: DetailViewProps = {
  bundle: {
    doc: {
      id: "sdoc-1",
      title: "Procedimiento trabajo seguro",
      description: null,
      internalCode: "PTS-001",
      categorySlug: "gestion_preventiva",
      status: "vigente",
      confidentiality: "publico_interno",
      worksiteId: null,
      effectiveFrom: null,
      expiresAt: null,
      currentVersionId: "sdv-1",
      requiresAcknowledgment: false,
      uploadedBy: "user-1",
      reviewedBy: null,
      approvedBy: null,
      responsibleUserId: null,
      tags: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
    versions: [{
      id: "sdv-1",
      version: 1,
      status: "vigente",
      fileName: "procedimiento.pdf",
      filePath: "sst/procedimiento.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
      checksum: "abc1234567890abc1234567890abc1234567890abc1234567890abc1234567890",
      effectiveFrom: null,
      effectiveTo: null,
      changelog: null,
      uploadedBy: "user-1",
      reviewedBy: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: "2026-07-02T00:00:00.000Z",
    }],
    links: [],
    acks: [],
    audit: [],
  },
  userMap: { "user-1": { id: "user-1", name: "Prevencionista", email: "prev@example.test" } },
  worksiteMap: {},
  linkEnrichment: {},
  canManage: true,
  canApprove: true,
  canArchive: true,
  canAck: true,
  canLink: true,
  currentUserId: "user-1",
  currentUserName: "Prevencionista",
}

describe("DocumentDetailView", () => {
  const currentVersion = baseProps.bundle.versions[0]!

  it("renders an inline preview and explicit download for the current version", () => {
    render(<DocumentDetailView {...baseProps} />)

    expect(screen.getByTitle("Previsualización de procedimiento.pdf")).toHaveAttribute("src", "/api/prevencion/documentacion/sdoc-1")
    expect(screen.getByRole("link", { name: /Descargar archivo/i })).toHaveAttribute("href", "/api/prevencion/documentacion/sdoc-1?download=1")
    expect(screen.queryByRole("tab", { name: /Asociaciones/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: /Acuses/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: /Bitácora/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Aprobar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Enviar a revisión/i })).not.toBeInTheDocument()
  })

  it("shows a restore action for archived documents", () => {
    render(
      <DocumentDetailView
        {...baseProps}
        bundle={{
          ...baseProps.bundle,
          doc: { ...baseProps.bundle.doc, status: "archivado" },
        }}
      />,
    )

    expect(screen.getByRole("button", { name: /Restaurar documento/i })).toBeInTheDocument()
  })

  it("shows a clear fallback when the current version cannot be previewed inline", () => {
    render(
      <DocumentDetailView
        {...baseProps}
        bundle={{
          ...baseProps.bundle,
          versions: [{
            ...currentVersion,
            fileName: "matriz.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }],
        }}
      />,
    )

    expect(screen.queryByTitle("Previsualización de matriz.xlsx")).not.toBeInTheDocument()
    expect(screen.getByText(/Vista previa no disponible/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Descargar archivo/i })).toHaveAttribute("href", "/api/prevencion/documentacion/sdoc-1?download=1")
  })
})
