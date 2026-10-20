// @vitest-environment jsdom

/**
 * Las acciones del registro (Acta PDF, Reabrir, Cancelar) que `page.tsx` monta
 * en `PageHeader.actions`, en captura y en lectura. Reabrir y cancelar se piden
 * con la versión VIGENTE del canal de guardado, no la de las props.
 */

import * as React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cancelInspectionRunAction = vi.fn()
const reopenInspectionRunAction = vi.fn()

vi.mock("../../actions", () => ({
  cancelInspectionRunAction,
  reopenInspectionRunAction,
  remindInspectionReviewAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { RunRecordActions } = await import("./run-record-actions")
const { publishRunVersion, resetRunVersionsForTests } = await import("./run-live-version")
const { writeInspectionDraft, readInspectionDrafts } = await import("@/lib/prevention/inspection-draft-storage")

const BASE = { runId: "run-acciones", code: "INS-ACC-001", version: 3, canReview: true, canManage: true }

beforeEach(() => {
  cancelInspectionRunAction.mockReset().mockResolvedValue({ ok: true, data: { version: 9 } })
  reopenInspectionRunAction.mockReset().mockResolvedValue({ ok: true, data: { version: 9 } })
  resetRunVersionsForTests()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

describe("RunRecordActions", () => {
  it("en captura sólo ofrece «Cancelar inspección»", () => {
    render(<RunRecordActions {...BASE} status="in_progress" />)
    expect(screen.getByRole("button", { name: "Cancelar inspección" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Acta PDF" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reabrir para rectificar" })).toBeNull()
  })

  it("declarada ejecutada ofrece el acta (un enlace a la impresión), reabrir y cancelar", () => {
    render(<RunRecordActions {...BASE} status="completed" />)
    const acta = screen.getByRole("link", { name: "Acta PDF" })
    expect(acta).toHaveAttribute("href", "/prevencion/inspecciones/run-acciones/print")
    expect(acta).toHaveAttribute("target", "_blank")
    expect(screen.getByRole("button", { name: "Reabrir para rectificar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar inspección" })).toBeInTheDocument()
  })

  it("sin permisos de revisar ni de gestionar queda sólo el acta", () => {
    render(<RunRecordActions {...BASE} status="reviewed" canReview={false} canManage={false} />)
    expect(screen.getByRole("link", { name: "Acta PDF" })).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("sin nada que ofrecer no pinta nada", () => {
    const { container } = render(<RunRecordActions {...BASE} status="cancelled" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("cancelar pide el motivo, usa la versión vigente del canal y limpia el borrador del dispositivo", async () => {
    writeInspectionDraft("run-acciones", { version: 3, userId: "u", drafts: { "s::a": { result: "conforming", comment: "", value: "", needsConfirmation: false } } })
    render(<RunRecordActions {...BASE} status="in_progress" />)
    // Un autoguardado avanzó la versión mientras la página seguía con la de sus props.
    React.act(() => publishRunVersion("run-acciones", 5))

    fireEvent.click(screen.getByRole("button", { name: "Cancelar inspección" }))
    const dialogo = await screen.findByRole("dialog")
    fireEvent.change(within(dialogo).getByLabelText(/^Motivo/), { target: { value: "La faena retiró el equipo de bodega." } })
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar inspección" }))

    await waitFor(() => expect(cancelInspectionRunAction).toHaveBeenCalledWith({
      runId: "run-acciones", expectedVersion: 5, reason: "La faena retiró el equipo de bodega.",
    }))
    await waitFor(() => expect(readInspectionDrafts("run-acciones")).toHaveLength(0))
  })

  it("reabrir usa la versión de las props mientras el canal no publique una mayor", async () => {
    render(<RunRecordActions {...BASE} status="completed" />)

    fireEvent.click(screen.getByRole("button", { name: "Reabrir para rectificar" }))
    const dialogo = await screen.findByRole("dialog")
    fireEvent.change(within(dialogo).getByLabelText(/^Motivo/), { target: { value: "Se declaró por error." } })
    fireEvent.click(within(dialogo).getByRole("button", { name: "Reabrir para rectificar" }))

    await waitFor(() => expect(reopenInspectionRunAction).toHaveBeenCalledWith({
      runId: "run-acciones", expectedVersion: 3, reason: "Se declaró por error.",
    }))
  })
})
