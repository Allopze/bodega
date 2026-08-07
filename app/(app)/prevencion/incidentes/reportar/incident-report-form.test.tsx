// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const reportPreventionIncidentAction = vi.hoisted(() => vi.fn())
const queueIncidentReport = vi.hoisted(() => vi.fn(async () => {}))
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock("@/lib/toast", () => ({ toast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("../actions", () => ({ reportPreventionIncidentAction }))
vi.mock("./offline-incident-queue", () => ({
  createIncidentSubmissionId: () => "sub-1",
  flushIncidentReportQueue: vi.fn(async () => ({ synchronized: 0, pending: 0 })),
  listQueuedIncidentReports: vi.fn(async () => []),
  queueIncidentReport,
}))

import { IncidentReportForm } from "./incident-report-form"

const NARRATIVE = "relato largo escrito en el celular por el supervisor"

function renderForm() {
  const view = render(
    <IncidentReportForm
      worksites={[{ id: "w1", name: "Faena Norte", code: "FN" }]}
      defaultDate="2026-08-07"
      defaultTime="10:00"
    />,
  )
  fireEvent.change(screen.getByLabelText("Empresa o empleador"), { target: { value: "Constructora X" } })
  fireEvent.change(screen.getByLabelText("Lugar exacto"), { target: { value: "Frente 3, cancha de acopio" } })
  fireEvent.change(screen.getByLabelText("¿Qué ocurrió?"), { target: { value: NARRATIVE } })
  return view
}

function narrative() {
  return screen.getByLabelText("¿Qué ocurrió?") as HTMLTextAreaElement
}

describe("IncidentReportForm", () => {
  it("conserva el relato cuando el servidor rechaza el reporte", async () => {
    // React 19 resetea el <form> apenas arranca la acción de `action={fn}`, así
    // que un {ok:false} borraba el relato ya escrito.
    reportPreventionIncidentAction.mockResolvedValue({
      ok: false,
      message: "La hora de conocimiento no puede ser anterior a la ocurrencia.",
    })
    const { container } = renderForm()

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La hora de conocimiento no puede ser anterior a la ocurrencia."))
    expect(narrative().value).toBe(NARRATIVE)
    expect((screen.getByLabelText("Empresa o empleador") as HTMLInputElement).value).toBe("Constructora X")
  })

  it("limpia el formulario cuando el reporte se acepta", async () => {
    reportPreventionIncidentAction.mockResolvedValue({ ok: true, message: "Incidente reportado", incidentId: "inc-1" })
    const { container } = renderForm()

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Incidente reportado"))
    expect(narrative().value).toBe("")
  })

  it("limpia el formulario cuando el reporte queda encolado sin conexión", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    try {
      const { container } = renderForm()

      fireEvent.submit(container.querySelector("form")!)

      await waitFor(() => expect(queueIncidentReport).toHaveBeenCalled())
      // Sin limpiar, reenviar genera otro clientSubmissionId y duplica el incidente.
      expect(narrative().value).toBe("")
    } finally {
      onLine.mockRestore()
    }
  })
})
