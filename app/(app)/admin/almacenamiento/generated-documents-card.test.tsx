// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GeneratedArchiveQueueOverview } from "@/lib/services/generated-documents/admin"
import { GeneratedDocumentsCard, type GeneratedDocumentsCardProps } from "./generated-documents-card"

const actions = vi.hoisted(() => ({
  retry: vi.fn(async () => ({ ok: true, message: "Documento subido a Cloudreve." })),
}))

vi.mock("./actions", () => ({
  saveGeneratedArchiveSettingsAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  testGeneratedArchiveFolderAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  retryGeneratedDocumentAction: actions.retry,
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => cleanup())

const emptyOverview: GeneratedArchiveQueueOverview = {
  counts: { pending: 0, staged: 0, uploaded: 3, failed: 1, superseded: 0 },
  attention: [{
    id: "gdoc-1", kind: "inspeccion", kindLabel: "Informe de inspección", milestone: "revisada", status: "failed",
    worksiteLabel: "Faena Norte", occurredAt: "2026-09-24T15:00:00.000Z", fileName: null, remoteKey: null,
    lastErrorCode: "RENDER_UNAUTHORIZED", lateRender: false, attempts: 1, renderMode: "session",
  }],
  recentUploads: [],
}

function renderCard(overrides: Partial<GeneratedDocumentsCardProps> = {}) {
  render(
    <GeneratedDocumentsCard
      settings={{ envEnabled: true, switchOn: false, basePath: "Documentos generados", basePathInvalid: false, layout: "faena" }}
      credentialsConfigured
      overview={emptyOverview}
      {...overrides}
    />,
  )
}

describe("GeneratedDocumentsCard", () => {
  it("sin la llave de entorno el switch no se puede encender y dice por qué", () => {
    renderCard({ settings: { envEnabled: false, switchOn: false, basePath: "Documentos generados", basePathInvalid: false, layout: "faena" } })
    expect(screen.getByLabelText("Archivar los documentos generados en Cloudreve")).toBeDisabled()
    expect(screen.getByText(/GENERATED_DOCS_ARCHIVE_ENABLED/)).toBeInTheDocument()
  })

  it("advierte que la carpeta de Cloudreve debe ser restringida", () => {
    renderCard()
    expect(screen.getByText(/debe ser restringida en Cloudreve/)).toBeInTheDocument()
  })

  it("muestra el motivo de un fallo en palabras y permite reintentarlo", async () => {
    renderCard()
    expect(screen.getByText("La sesión que lo imprimió no puede ver el documento.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    await waitFor(() => expect(actions.retry).toHaveBeenCalledWith("gdoc-1"))
  })

  it("ofrece los dos órdenes de carpetas", () => {
    renderCard()
    expect(screen.getByLabelText(/Por faena/)).toBeChecked()
    expect(screen.getByLabelText(/Año › faena › módulo/)).not.toBeChecked()
  })
})
