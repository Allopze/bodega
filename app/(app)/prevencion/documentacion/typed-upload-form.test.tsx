// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TypedUploadForm } from "./typed-upload-form"

Element.prototype.scrollIntoView = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("./actions", () => ({
  uploadTypedSstDocumentAction: vi.fn(),
  listSstDocumentsOfTypeAction: vi.fn(async () => ({ ok: true, data: { documents: [] } })),
  previewSstDocumentUploadEffectsAction: vi.fn(async () => ({ ok: true, data: { effects: null } })),
}))

afterEach(() => cleanup())

const types = [{
  id: "t-irl", name: "Registro de IRL de la faena", code: "IRL-REG",
  categoryName: "Capacitación", requiresApproval: false, defaultValidityMonths: 12,
}]

function renderForm(props: { worksites: Array<{ id: string; name: string }>; canUploadCorporate: boolean; folderWorksiteId?: string | null }) {
  render(
    <TypedUploadForm
      types={types}
      worksites={props.worksites}
      canUploadCorporate={props.canUploadCorporate}
      currentFolderId={null}
      folderWorksiteId={props.folderWorksiteId ?? null}
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
}

describe("la faena en la subida tipada", () => {
  it("quien opera una sola faena no elige: su faena queda fija", () => {
    renderForm({ worksites: [{ id: "ws-norte", name: "Faena Norte" }], canUploadCorporate: false })
    const field = screen.getByLabelText("Faena")
    expect(field).toHaveValue("Faena Norte")
    expect(field).toHaveAttribute("readonly")
    expect(screen.queryByRole("combobox", { name: "Faena del documento" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Corporativo/)).not.toBeInTheDocument()
  })

  it("con alcance global se elige la faena o un documento corporativo", () => {
    renderForm({
      worksites: [{ id: "ws-norte", name: "Faena Norte" }, { id: "ws-sur", name: "Faena Sur" }],
      canUploadCorporate: true,
    })
    expect(screen.getByRole("combobox", { name: "Faena del documento" })).toBeInTheDocument()
    expect(screen.getByText(/Corporativo: un documento de toda la empresa/)).toBeInTheDocument()
  })

  it("la carpeta de una faena fija la faena también para el alcance global", () => {
    renderForm({
      worksites: [{ id: "ws-norte", name: "Faena Norte" }, { id: "ws-sur", name: "Faena Sur" }],
      canUploadCorporate: true,
      folderWorksiteId: "ws-sur",
    })
    expect(screen.getByLabelText("Faena")).toHaveValue("Faena Sur")
    expect(screen.getByText("La carpeta abierta pertenece a esta faena.")).toBeInTheDocument()
  })
})
