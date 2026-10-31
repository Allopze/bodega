// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const requestReviewAction = vi.fn()
const withdrawReviewRequestAction = vi.fn()
const refresh = vi.fn()

vi.mock("@/app/(app)/combustibles/bitacora/actions", () => ({
  requestReviewAction: (...args: unknown[]) => requestReviewAction(...args),
  withdrawReviewRequestAction: (...args: unknown[]) => withdrawReviewRequestAction(...args),
}))
vi.mock("@/app/(app)/combustibles/revisar/actions", () => ({ decideFlaggedLoadsAction: vi.fn(), reopenFlaggedDecisionAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/combustibles/cargas" }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { ReviewRequestControl } from "./review-request-control"
import { LoadReviewStatus, LoadTimeline } from "./load-sections"
import type { LoadReviewState } from "@/lib/combustibles/fuel-log-detail"

beforeEach(() => {
  requestReviewAction.mockReset().mockResolvedValue({ ok: true, markId: "m-1" })
  withdrawReviewRequestAction.mockReset().mockResolvedValue({ ok: true, markId: "m-1" })
  refresh.mockClear()
})
afterEach(() => cleanup())

describe("«Pedir que la revisen»", () => {
  it("exige la nota de 10 caracteres antes de enviar y manda fuente, carga y nota", async () => {
    render(<ReviewRequestControl source="tae_pwa" entityId="tae-1" openRequest={null} canWithdraw={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Pedir que la revisen" }))

    const submit = await screen.findByRole("button", { name: "Pedir revisión" })
    expect(submit).toBeDisabled()
    const note = screen.getByRole("textbox")
    fireEvent.change(note, { target: { value: "muy corta" } })
    expect(submit).toBeDisabled()
    expect(screen.getByText("Escribe al menos 10 caracteres.")).toBeInTheDocument()

    fireEvent.change(note, { target: { value: "Los litros parecen altos" } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(requestReviewAction).toHaveBeenCalledWith("tae_pwa", "tae-1", "Los litros parecen altos"))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("muestra el motivo del rechazo del servidor sin cerrar el diálogo", async () => {
    requestReviewAction.mockResolvedValue({ ok: false, message: "Esta carga ya tiene un pedido de revisión abierto." })
    render(<ReviewRequestControl source="invoiced" entityId="inv-1" openRequest={null} canWithdraw={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Pedir que la revisen" }))
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Revisar la boleta, no cuadra" } })
    fireEvent.click(screen.getByRole("button", { name: "Pedir revisión" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("ya tiene un pedido de revisión abierto")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("con un pedido abierto lo muestra y lo retira (sin confirmación) sólo quien puede", async () => {
    const open = { id: "m-1", note: "Revisar los litros", markedByName: "Pedro" }
    const { unmount } = render(<ReviewRequestControl source="tae_pwa" entityId="tae-1" openRequest={open} canWithdraw />)
    fireEvent.click(screen.getByRole("button", { name: "Revisión pedida" }))
    expect(await screen.findByText(/Pedro/)).toBeInTheDocument()
    expect(screen.getByText("Revisar los litros")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retirar el pedido" }))
    await waitFor(() => expect(withdrawReviewRequestAction).toHaveBeenCalledWith("m-1"))
    unmount()

    render(<ReviewRequestControl source="tae_pwa" entityId="tae-1" openRequest={open} canWithdraw={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Revisión pedida" }))
    expect(await screen.findByText(/Sólo quien lo pidió/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retirar el pedido" })).not.toBeInTheDocument()
  })
})

const review = (overrides: Partial<LoadReviewState> = {}): LoadReviewState => ({
  equipmentLoadId: "el-1", reviewStatus: "flagged", flagReasons: ["meter_regression"], reviewNote: null,
  reviewedByName: null, reviewedAt: null, performanceStatus: "meter_regression", createdAt: "2026-10-30T08:12:00.000Z", duplicateOfId: null,
  ...overrides,
})

describe("estado de revisión de la plataforma en la ficha", () => {
  it("por decidir: dice el motivo, el efecto y enlaza a la bandeja", () => {
    render(<LoadReviewStatus review={review()} search={{ periodo: "2026-10", faena: "w-1" }} />)
    expect(screen.getByText("Esta carga espera una decisión")).toBeInTheDocument()
    expect(screen.getByText("Lectura de medidor menor a la anterior")).toBeInTheDocument()
    expect(screen.getByText(/sus litros cuentan, pero la carga no entra al promedio/)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Decidir en «Por revisar»/ })
    const href = link.getAttribute("href")!
    expect(href).toContain("/combustibles/revisar?")
    expect(href).toContain("tipo=carga")
    expect(href).toContain("item=carga%3Ael-1")
    expect(href).toContain("periodo=2026-10")
  })

  it("sólo ofrece decidir en la ficha a quien puede", () => {
    const { unmount } = render(<LoadReviewStatus review={review()} canDecide equipmentLabel="CA-14" />)
    expect(screen.getByRole("link", { name: /Verla en «Por revisar»/ })).toBeInTheDocument()
    unmount()
    render(<LoadReviewStatus review={review({ reviewStatus: "approved", reviewedByName: "Jefa", reviewNote: "Se cambió el tablero" })} canDecide equipmentLabel="CA-14" />)
    expect(screen.getByRole("button", { name: /Deshacer la decisión sobre CA-14/ })).toBeInTheDocument()
    expect(screen.getByText("Cuenta")).toBeInTheDocument()
    expect(screen.getByText(/Lo decidió Jefa/)).toBeInTheDocument()
  })

  it("decidida sin permiso de decidir no ofrece deshacer; sin observaciones lo dice", () => {
    const { unmount } = render(<LoadReviewStatus review={review({ reviewStatus: "rejected", reviewedByName: "Jefa" })} />)
    expect(screen.getByText("No cuenta")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Deshacer/ })).not.toBeInTheDocument()
    unmount()
    render(<LoadReviewStatus review={review({ reviewStatus: "ok", flagReasons: [] })} />)
    expect(screen.getByText(/Sin observaciones/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Por revisar/ })).not.toBeInTheDocument()
  })

  it("sin fila proyectada dice que la plataforma todavía no la revisa", () => {
    render(<LoadReviewStatus review={null} />)
    expect(screen.getByText("La plataforma todavía no revisa esta carga.")).toBeInTheDocument()
  })
})

describe("línea de tiempo en pantalla", () => {
  it("muestra la frase, la nota entre comillas y la hora", () => {
    render(<LoadTimeline events={[{ key: "a", at: "2026-10-30T12:00:00.000Z", actor: "Ana", text: "Ana validó la carga", note: "Todo en orden", tone: "success" }]} />)
    expect(screen.getByText("Ana validó la carga")).toBeInTheDocument()
    expect(screen.getByText("«Todo en orden»")).toBeInTheDocument()
  })

  it("sin hechos, lo dice en vez de dejar un hueco", () => {
    render(<LoadTimeline events={[]} />)
    expect(screen.getByText(/Todavía no hay movimientos/)).toBeInTheDocument()
  })
})
