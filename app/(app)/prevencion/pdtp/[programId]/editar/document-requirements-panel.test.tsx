// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentRequirementsPanel } from "./document-requirements-panel"
import { setPdtpActivityDocumentRequirementsAction } from "../../actions"

const refresh = vi.fn()
Element.prototype.scrollIntoView = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("../../actions", () => ({ setPdtpActivityDocumentRequirementsAction: vi.fn(async () => ({ ok: true, message: "Carpeta documental guardada." })) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const types = [
  { id: "t-riohs", name: "Reglamento Interno de Higiene y Seguridad", code: "RIOHS", categoryName: "Legal y normativa" },
  { id: "t-seremi", name: "Carta conductora del RIOHS a la SEREMI de Salud", code: "RIOHS-SEREMI", categoryName: "Legal y normativa" },
]
const activity = { id: "act-19", n: 19, activity: "Mantener carpetas de requisitos legales" }

describe("DocumentRequirementsPanel", () => {
  it("una carpeta vacía avisa que bloquea el envío a revisión", () => {
    render(<DocumentRequirementsPanel programId="p1" activity={activity} requirements={[]} documentTypes={types} editable />)
    expect(screen.getByText(/no puede enviarse a revisión/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Guardar carpeta" })).toBeDisabled()
  })

  it("guarda la carpeta con su alcance y la condición de ser posterior al RIOHS", async () => {
    render(
      <DocumentRequirementsPanel
        programId="p1"
        activity={activity}
        requirements={[
          { documentTypeId: "t-riohs", scope: "corporativo", mustFollowDocumentTypeId: null },
          { documentTypeId: "t-seremi", scope: "corporativo", mustFollowDocumentTypeId: "t-riohs" },
        ]}
        documentTypes={types}
        editable
      />,
    )
    // Quitar el RIOHS deja a la carta sin ancla: la condición se limpia sola.
    fireEvent.click(screen.getByRole("button", { name: "Quitar Reglamento Interno de Higiene y Seguridad" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar carpeta" }))
    await waitFor(() => expect(setPdtpActivityDocumentRequirementsAction).toHaveBeenCalledWith({
      programId: "p1",
      activityId: "act-19",
      requirements: [{ documentTypeId: "t-seremi", scope: "corporativo", mustFollowDocumentTypeId: null }],
    }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("con el programa firmado se muestra, pero no se edita", () => {
    render(
      <DocumentRequirementsPanel
        programId="p1"
        activity={activity}
        requirements={[{ documentTypeId: "t-riohs", scope: "corporativo", mustFollowDocumentTypeId: null }]}
        documentTypes={types}
        editable={false}
      />,
    )
    expect(screen.queryByRole("button", { name: "Guardar carpeta" })).not.toBeInTheDocument()
    expect(screen.getByText(/se cambia en una revisión nueva/)).toBeInTheDocument()
  })
})
