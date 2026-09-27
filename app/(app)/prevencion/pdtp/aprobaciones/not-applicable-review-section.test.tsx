// @vitest-environment jsdom
/**
 * PREV-C07 (T2): la bandeja de "No aplica" pendientes en Aprobaciones. Lo que
 * se fija: cada fila dice qué se excluye y por qué, quien declaró no ve los
 * botones sobre su propia declaración, y rechazar exige motivo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const reviewPdtpNotApplicableAction = vi.fn(async (_formData: FormData) => ({ ok: true }))
vi.mock("../actions", () => ({
  reviewPdtpNotApplicableAction: (fd: FormData) => reviewPdtpNotApplicableAction(fd),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { NotApplicableReviewSection } from "./not-applicable-review-section"

afterEach(cleanup)
beforeEach(() => { reviewPdtpNotApplicableAction.mockClear() })

const row = (overrides: Partial<Parameters<typeof NotApplicableReviewSection>[0]["items"][number]> = {}) => ({
  id: "dev-1",
  activityN: 12,
  activityName: "Charla de 5 minutos",
  worksiteName: "Faena Norte",
  year: 2026,
  month: 3,
  week: 2,
  reason: "La faena estuvo detenida toda la semana por mantención.",
  createdByUserId: "user-declara",
  createdByName: "Declarante",
  createdAt: "2026-03-10T12:00:00.000Z",
  ...overrides,
})

describe("NotApplicableReviewSection", () => {
  it("sin pendientes muestra un estado vacío en lenguaje de usuario", () => {
    render(<NotApplicableReviewSection items={[]} currentUserId="user-revisa" />)
    expect(screen.getByText(/Sin "no aplica" por revisar/)).toBeInTheDocument()
  })

  it("muestra actividad, faena, semana, motivo y quién lo declaró", () => {
    render(<NotApplicableReviewSection items={[row()]} currentUserId="user-revisa" />)
    const item = screen.getByRole("listitem")
    expect(within(item).getByText(/N°12/)).toBeInTheDocument()
    expect(within(item).getByText(/Faena Norte/)).toBeInTheDocument()
    expect(within(item).getByText(/Mar · semana 2/)).toBeInTheDocument()
    expect(within(item).getByText("La faena estuvo detenida toda la semana por mantención.")).toBeInTheDocument()
    expect(within(item).getByText(/Declarante/)).toBeInTheDocument()
  })

  it("aprobar envía la decisión con el id del desvío", async () => {
    render(<NotApplicableReviewSection items={[row()]} currentUserId="user-revisa" />)
    fireEvent.click(screen.getByRole("button", { name: /Aprobar "no aplica" de N°12/ }))
    await waitFor(() => expect(reviewPdtpNotApplicableAction).toHaveBeenCalledTimes(1))
    const sent = reviewPdtpNotApplicableAction.mock.calls[0]![0]
    expect(sent.get("deviationId")).toBe("dev-1")
    expect(sent.get("decision")).toBe("approve")
  })

  it("rechazar exige un motivo de al menos 10 caracteres", async () => {
    render(<NotApplicableReviewSection items={[row()]} currentUserId="user-revisa" />)
    fireEvent.click(screen.getByRole("button", { name: /Rechazar "no aplica" de N°12/ }))
    const confirm = await screen.findByRole("button", { name: "Rechazar" })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo del rechazo"), { target: { value: "La faena sí operó esa semana." } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(reviewPdtpNotApplicableAction).toHaveBeenCalledTimes(1))
    const sent = reviewPdtpNotApplicableAction.mock.calls[0]![0]
    expect(sent.get("decision")).toBe("reject")
    expect(sent.get("reason")).toBe("La faena sí operó esa semana.")
  })

  it("quien lo declaró no ve botones: lo revisa otra persona", () => {
    render(<NotApplicableReviewSection items={[row({ createdByUserId: "user-revisa" })]} currentUserId="user-revisa" />)
    expect(screen.queryByRole("button", { name: /Aprobar/ })).not.toBeInTheDocument()
    expect(screen.getByText(/lo revisa otra persona/)).toBeInTheDocument()
  })
})
