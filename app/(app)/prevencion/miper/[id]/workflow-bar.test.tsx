// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams() }))
const submitMiperAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ submitMiperAction, approveMiperFinalAction: vi.fn(), approveMiperTechnicalAction: vi.fn(), discardMiperDraftAction: vi.fn(), requestMiperCorrectionsAction: vi.fn(), returnMiperAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { WorkflowBar } from "./workflow-bar"

const workspace = {
  matrix: { id: "m1", version: 3, status: "draft", reviewState: "none" },
  versions: [], openRound: null, pendingDiff: { hasChanges: false, headerFields: [], entries: [] },
  snapshot: { header: {}, entries: [{ id: "e1", rowNumber: 3 }] },
} as unknown as MiperWorkspace
const mode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null } as WorkspaceMode
const issues: CompletenessIssue[] = [
  { scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" },
  { scope: "entry", entryId: "e1", field: "hazard", message: "Falta el peligro.", severity: "error" },
]

describe("WorkflowBar", () => {
  it("«Ficha del documento» va primero y el envío ya no arrastra «(N pendientes)»", () => {
    const onOpenFicha = vi.fn()
    render(<WorkflowBar workspace={workspace} mode={mode} issues={issues} openObservations={0} onOpenFicha={onOpenFicha} onOpenEntry={vi.fn()} />)
    const buttons = screen.getAllByRole("button")
    expect(buttons[0]!.textContent).toBe("Ficha del documento")
    expect(screen.getByRole("button", { name: "Enviar a revisión" }).textContent).toBe("Enviar a revisión")
    fireEvent.click(buttons[0]!)
    expect(onOpenFicha).toHaveBeenCalledTimes(1)
  })

  it("con bloqueos, el envío abre la lista: los de cabecera abren la ficha y los de fila el riesgo", () => {
    const onOpenFicha = vi.fn()
    const onOpenEntry = vi.fn()
    render(<WorkflowBar workspace={workspace} mode={mode} issues={issues} openObservations={0} onOpenFicha={onOpenFicha} onOpenEntry={onOpenEntry} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a revisión" }))
    expect(submitMiperAction).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "Faltan 2 datos para enviar" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Ficha del documento: Falta la fecha de elaboración/ }))
    expect(onOpenFicha).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a revisión" }))
    fireEvent.click(screen.getByRole("button", { name: /Riesgo #3: Falta el peligro/ }))
    expect(onOpenEntry).toHaveBeenCalledWith("e1", "identificacion")
  })

  it("agrupa todos los bloqueos, incluso después del 40, y lleva al paso correcto", () => {
    const many: CompletenessIssue[] = [
      ...issues,
      ...Array.from({ length: 42 }, (_, index) => ({ scope: "control" as const, entryId: "e1", field: "dueDate", message: `Medida ${index + 1}: falta plazo.`, severity: "error" as const })),
      { scope: "entry", entryId: "e1", field: "programLink", message: "Falta vincular al programa.", severity: "error" },
      { scope: "entry", entryId: "e1", field: "classification", message: "Advertencia que no bloquea", severity: "warning" },
    ]
    const onOpenEntry = vi.fn()
    render(<WorkflowBar workspace={workspace} mode={mode} issues={many} openObservations={0} onOpenFicha={vi.fn()} onOpenEntry={onOpenEntry} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a revisión" }))
    expect(screen.getByRole("heading", { name: "Ficha del documento (1)" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Identificación y evaluación (1)" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Medidas de control (42)" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Vínculos al Programa de Trabajo (1)" })).toBeTruthy()
    expect(screen.queryByText("Advertencia que no bloquea")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Riesgo #3: Medida 42: falta plazo." }))
    expect(onOpenEntry).toHaveBeenLastCalledWith("e1", "medidas")
    fireEvent.click(screen.getByRole("button", { name: "Enviar a revisión" }))
    fireEvent.click(screen.getByRole("button", { name: "Riesgo #3: Falta vincular al programa." }))
    expect(onOpenEntry).toHaveBeenLastCalledWith("e1", "seguimiento")
  })
  it("descargar y descartar viven en «Más»", () => {
    render(<WorkflowBar workspace={workspace} mode={mode} issues={[]} openObservations={0} onOpenFicha={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Descartar borrador" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("button", { name: "Más acciones de la MIPER" }), { key: "Enter" })
    expect(screen.getByRole("menuitem", { name: "Descartar borrador" })).toBeTruthy()
  })

  // Abierto desde un ítem de menú, el foco caía al `body` al cancelar.
  it("cancelar «Descartar borrador» devuelve el foco a «Más»", async () => {
    render(<WorkflowBar workspace={workspace} mode={mode} issues={[]} openObservations={0} onOpenFicha={vi.fn()} />)
    const more = screen.getByRole("button", { name: "Más acciones de la MIPER" })
    fireEvent.keyDown(more, { key: "Enter" })
    fireEvent.click(screen.getByRole("menuitem", { name: "Descartar borrador" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(more))
  })

  it("«La matriz no tiene registros» abre Riesgos para crear la primera tarea", () => {
    const onOpenFicha = vi.fn()
    const empty: CompletenessIssue[] = [{ scope: "header", field: "entries", message: "La matriz no tiene registros de evaluación.", severity: "error" }]
    render(<WorkflowBar workspace={workspace} mode={mode} issues={empty} openObservations={0} onOpenFicha={onOpenFicha} onOpenEntry={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a revisión" }))
    const dialog = screen.getByRole("dialog", { name: "Falta 1 dato para enviar" })
    expect(dialog.textContent).toContain("Riesgos: La matriz no tiene registros de evaluación.")
    expect(screen.getByRole("link", { name: /no tiene registros/ }).getAttribute("href")).toBe("/prevencion/miper/m1")
    expect(onOpenFicha).not.toHaveBeenCalled()
  })

  it("«Devolver con observaciones» cuenta las abiertas en singular y plural", () => {
    const reviewer = { ...mode, canEdit: false, canReviewTechnical: true } as WorkspaceMode
    const reviewing = { ...workspace, matrix: { ...workspace.matrix, status: "in_review", reviewState: "technical" }, openRound: { id: "r1", stage: "technical", roundNumber: 1 } } as unknown as MiperWorkspace
    const { unmount } = render(<WorkflowBar workspace={reviewing} mode={reviewer} issues={[]} openObservations={1} onOpenFicha={vi.fn()} onOpenEntry={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Devolver con observaciones" }))
    expect(screen.getByText("La MIPER vuelve a la prevencionista con 1 observación abierta.")).toBeTruthy()
    unmount()
    render(<WorkflowBar workspace={reviewing} mode={reviewer} issues={[]} openObservations={3} onOpenFicha={vi.fn()} onOpenEntry={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Devolver con observaciones" }))
    expect(screen.getByText("La MIPER vuelve a la prevencionista con 3 observaciones abiertas.")).toBeTruthy()
  })
})
