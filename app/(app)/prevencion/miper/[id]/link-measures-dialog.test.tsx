// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { ProgramActionView } from "@/lib/services/miper/program-queries"

const link = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ linkProgramControlsAction: link }))

import { LinkMeasuresDialog } from "./link-measures-dialog"

const control = (id: string, description: string, status = "proposed") => ({
  id, hierarchy: "ppe" as const, description, responsibleUserId: null, responsibleName: null, dueDate: null, status,
})
const row = (id: string, rowNumber: number, hazard: string, controls: ReturnType<typeof control>[]) =>
  ({ id, rowNumber, hazard, controls }) as unknown as MiperEntrySnapshot

const rows = [
  row("e1", 1, "Caída de altura", [control("c1", "Arnés"), control("c2", "Línea de vida"), control("c9", "Medida retirada", "retired")]),
  row("e2", 2, "Ruido", [control("c3", "Protección auditiva")]),
]
const action = {
  id: "a1", actionNumber: 4, controls: [{ id: "c1", rowNumber: 1, description: "Arnés" }],
} as unknown as ProgramActionView

function renderDialog(onOpenChange = vi.fn()) {
  render(<LinkMeasuresDialog matrixId="m1" programId="p1" action={action} rows={rows} open onOpenChange={onOpenChange} />)
  return onOpenChange
}

afterEach(() => { vi.clearAllMocks() })

describe("LinkMeasuresDialog", () => {
  it("marca las vinculadas", () => {
    renderDialog()
    expect(screen.getByRole("dialog", { name: "Medidas de la actividad N° 4" })).toBeTruthy()
    expect((screen.getByRole("checkbox", { name: "Fila 1: Arnés" }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole("checkbox", { name: "Fila 1: Línea de vida" }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole("checkbox", { name: /Medida retirada/ })).toBeNull()
    expect(screen.getByText("Riesgo #2: Ruido")).toBeTruthy()
  })

  it("guarda agregadas con link true y quitadas con link false", async () => {
    link.mockResolvedValue({ ok: true })
    const onOpenChange = renderDialog()
    fireEvent.click(screen.getByRole("checkbox", { name: "Fila 2: Protección auditiva" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Fila 1: Arnés" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar vínculos" }))
    await waitFor(() => expect(link).toHaveBeenCalledTimes(2))
    expect(link).toHaveBeenCalledWith({ matrixId: "m1", programId: "p1", actionId: "a1", controlIds: ["c3"], link: true })
    expect(link).toHaveBeenCalledWith({ matrixId: "m1", programId: "p1", actionId: "a1", controlIds: ["c1"], link: false })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("sin cambios, Guardar vínculos deshabilitado", () => {
    renderDialog()
    expect((screen.getByRole("button", { name: "Guardar vínculos" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox", { name: "Fila 1: Línea de vida" }))
    expect((screen.getByRole("button", { name: "Guardar vínculos" }) as HTMLButtonElement).disabled).toBe(false)
  })
})
