// @vitest-environment jsdom
/**
 * PRV-02 (auditoría 2026-09-28): una ejecución que llegó de otro módulo sin
 * evidencia verificada no se aprueba con un clic. El ✓ abre un diálogo que
 * exige decir qué se revisó, y ese motivo viaja a la acción. Las demás se
 * siguen aprobando directo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const approvePdtpExecutionAction = vi.fn(async (_id: string, _reason?: string) => ({ ok: true }))
vi.mock("./actions", () => ({
  approvePdtpExecutionAction: (id: string, reason?: string) => approvePdtpExecutionAction(id, reason),
  rejectPdtpExecutionAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PdtpApprovalButtons } from "./pdtp-approval-buttons"

afterEach(cleanup)
beforeEach(() => approvePdtpExecutionAction.mockClear())

describe("PdtpApprovalButtons", () => {
  it("aprueba directo una ejecución con evidencia verificada", async () => {
    render(<PdtpApprovalButtons activityId="a-1" pendingApprovals={[{ id: "e-1", activityId: "a-1", month: 3, week: 2 }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Aprobar ejecución Mar semana 2" }))
    await waitFor(() => expect(approvePdtpExecutionAction).toHaveBeenCalledWith("e-1", undefined))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("pide el motivo antes de aprobar una integración sin evidencia verificada", async () => {
    render(<PdtpApprovalButtons activityId="a-1" pendingApprovals={[{ id: "e-2", activityId: "a-1", month: 4, week: 1, needsApprovalReason: true }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Aprobar ejecución Abr semana 1" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("sin evidencia verificada")
    expect(approvePdtpExecutionAction).not.toHaveBeenCalled()

    const confirm = screen.getByRole("button", { name: "Aprobar con motivo" })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo de la aprobación" }), { target: { value: "Revisé el acta en el módulo CPHS." } })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(approvePdtpExecutionAction).toHaveBeenCalledWith("e-2", "Revisé el acta en el módulo CPHS."))
  })
})
