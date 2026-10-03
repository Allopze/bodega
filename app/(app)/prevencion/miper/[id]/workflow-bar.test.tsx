// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
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
    expect(onOpenEntry).toHaveBeenCalledWith("e1")
  })

  it("descargar y descartar viven en «Más»", () => {
    render(<WorkflowBar workspace={workspace} mode={mode} issues={[]} openObservations={0} onOpenFicha={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Descartar borrador" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("button", { name: "Más acciones de la MIPER" }), { key: "Enter" })
    expect(screen.getByRole("menuitem", { name: "Descartar borrador" })).toBeTruthy()
  })

  it("«La matriz no tiene registros» no abre la ficha (no se corrige ahí): queda como texto «Matriz: …»", () => {
    const onOpenFicha = vi.fn()
    const empty: CompletenessIssue[] = [{ scope: "header", field: "entries", message: "La matriz no tiene registros de evaluación.", severity: "error" }]
    render(<WorkflowBar workspace={workspace} mode={mode} issues={empty} openObservations={0} onOpenFicha={onOpenFicha} onOpenEntry={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a revisión" }))
    const dialog = screen.getByRole("dialog", { name: "Faltan 1 dato para enviar" })
    expect(dialog.textContent).toContain("Matriz: La matriz no tiene registros de evaluación.")
    expect(screen.queryByRole("button", { name: /no tiene registros/ })).toBeNull()
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
