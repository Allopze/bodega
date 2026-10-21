// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const reportPreventionIncidentAction = vi.hoisted(() => vi.fn())
const queueIncidentReport = vi.hoisted(() => vi.fn(async () => {}))
const listQueuedIncidentReports = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []))
const flushIncidentReportQueue = vi.hoisted(() => vi.fn(async () => ({ synchronized: 0, pending: 0, rejected: 0 })))
const migrateLegacyIncidentReportQueue = vi.hoisted(() => vi.fn(async () => 0))
const putRe20OfflineDraft = vi.hoisted(() => vi.fn(async () => ({})))
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
  flushIncidentReportQueue,
  listQueuedIncidentReports,
  migrateLegacyIncidentReportQueue,
  discardQueuedIncidentReport: vi.fn(async () => {}),
  queueIncidentReport,
}))
vi.mock("@/lib/prevention/re20-offline-drafts", () => ({ putRe20OfflineDraft }))

import { IncidentReportForm } from "./incident-report-form"

const NARRATIVE = "relato largo escrito en el celular por el supervisor"

function renderForm() {
  const view = render(
    <IncidentReportForm
      worksites={[{ id: "w1", name: "Faena Norte", code: "FN" }]}
      defaultDate="2026-08-07"
      defaultTime="10:00"
      userId="user-test"
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

const QUEUED_ENTRY = {
  id: "incident-report:offline-1",
  kind: "incident_report",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
  attempts: 0,
  payload: { clientSubmissionId: "offline-1", location: "Patio norte" },
}

describe("IncidentReportForm", () => {
  beforeEach(() => {
    listQueuedIncidentReports.mockReset().mockResolvedValue([])
    flushIncidentReportQueue.mockClear()
    migrateLegacyIncidentReportQueue.mockClear()
    putRe20OfflineDraft.mockClear()
    queueIncidentReport.mockClear()
  })

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

  it("permite crear un reporte desde el shell offline aunque el navegador tenga conexión", async () => {
    reportPreventionIncidentAction.mockClear()
    const view = render(
      <IncidentReportForm
        worksites={[{ id: "w1", name: "Faena Norte", code: "FN" }]}
        defaultDate="2026-08-07"
        defaultTime="10:00"
        userId="user-test"
        offlineOnly
      />,
    )
    fireEvent.change(screen.getByLabelText("Empresa o empleador"), { target: { value: "Constructora X" } })
    fireEvent.change(screen.getByLabelText("Lugar exacto"), { target: { value: "Frente 3, cancha de acopio" } })
    fireEvent.change(screen.getByLabelText("¿Qué ocurrió?"), { target: { value: NARRATIVE } })
    fireEvent.submit(view.container.querySelector("form")!)
    await waitFor(() => expect(queueIncidentReport).toHaveBeenCalled())
    expect(reportPreventionIncidentAction).not.toHaveBeenCalled()
  })
  it("con conexión y sin nada pendiente no muestra avisos ni pide preparar nada", () => {
    renderForm()
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByText(/bóveda|frase|cifrad/i)).toBeNull()
    expect(screen.queryByRole("button", { name: /preparar para/i })).toBeNull()
  })

  it("sin conexión avisa, en lenguaje de usuario, que lo escrito se guarda solo y se envía al volver la señal", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    try {
      renderForm()
      const notice = screen.getByRole("status")
      expect(notice.textContent).toContain("Sin conexión: lo que escribas se guarda en este equipo y se envía al volver la señal.")
      expect(notice.textContent).toContain("No cierres sesión hasta entonces.")
      expect(screen.queryByText(/bóveda|frase|cifrad/i)).toBeNull()
      expect(screen.getByRole("button", { name: "Guardar para enviar después" })).toBeTruthy()
    } finally {
      onLine.mockRestore()
    }
  })

  it("con reportes guardados con conexión los envía solo al cargar y los muestra mientras tanto", async () => {
    listQueuedIncidentReports.mockResolvedValue([QUEUED_ENTRY])
    renderForm()
    await waitFor(() => expect(flushIncidentReportQueue).toHaveBeenCalledWith("user-test", expect.any(Function)))
    expect(await screen.findByText("1 reporte guardado en este equipo, sin enviar.")).toBeTruthy()
    expect(screen.getByText("Reporte en Patio norte")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enviar ahora" })).toBeTruthy()
  })

  it("sin conexión con reportes guardados dice que se enviarán al volver la conexión y no intenta enviarlos", async () => {
    listQueuedIncidentReports.mockResolvedValue([QUEUED_ENTRY, { ...QUEUED_ENTRY, id: "incident-report:offline-2" }])
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    try {
      renderForm()
      expect(await screen.findByText("2 reportes guardados en este equipo, se enviarán al volver la conexión.")).toBeTruthy()
      expect(flushIncidentReportQueue).not.toHaveBeenCalled()
    } finally {
      onLine.mockRestore()
    }
  })

  it("avisa aparte los reportes que el servidor rechazó y no los cuenta como pendientes", async () => {
    listQueuedIncidentReports.mockResolvedValue([{ ...QUEUED_ENTRY, rejected: true, lastError: "La faena no existe" }])
    renderForm()
    expect(await screen.findByText(/1 reporte fue rechazado por el servidor/)).toBeTruthy()
    expect(screen.queryByText(/guardado en este equipo, sin enviar/)).toBeNull()
  })

  it("al cargar guarda las faenas en este equipo y pasa la cola antigua al almacén de la persona", async () => {
    renderForm()
    await waitFor(() => expect(migrateLegacyIncidentReportQueue).toHaveBeenCalledWith("user-test"))
    expect(putRe20OfflineDraft).toHaveBeenCalledWith("user-test", expect.objectContaining({
      id: "incident-report-config",
      kind: "incident_report_config",
      payload: expect.objectContaining({ worksites: [{ id: "w1", name: "Faena Norte", code: "FN" }] }),
    }))
  })

  it("en la pantalla sin conexión no migra, no guarda faenas ni envía", async () => {
    render(<IncidentReportForm worksites={[{ id: "w1", name: "Faena Norte", code: "FN" }]} defaultDate="2026-08-07" defaultTime="10:00" userId="user-test" offlineOnly />)
    await waitFor(() => expect(listQueuedIncidentReports).toHaveBeenCalled())
    expect(migrateLegacyIncidentReportQueue).not.toHaveBeenCalled()
    expect(putRe20OfflineDraft).not.toHaveBeenCalled()
    expect(flushIncidentReportQueue).not.toHaveBeenCalled()
    expect(screen.getByRole("status").textContent).toContain("se envía cuando abras la aplicación con conexión")
  })
})
