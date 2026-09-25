// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  addPreventionIncidentEvidenceAction: vi.fn(async () => ({ ok: false, message: "La referencia no es verificable." })),
  authorizePreventionIncidentRestartAction: vi.fn(async () => ({ ok: true })),
  classifyIncidentPersonForIndicatorsAction: vi.fn(async () => ({ ok: true })),
  createPreventionIncidentCapaAction: vi.fn(async () => ({ ok: true })),
  recordPreventionIncidentNotificationAction: vi.fn(async () => ({ ok: true })),
  savePreventionIncidentInvestigationAction: vi.fn(async () => ({ ok: true, message: "Investigación guardada" })),
  transitionPreventionIncidentAction: vi.fn(async () => ({ ok: true })),
  triagePreventionIncidentAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock("../actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { IncidentWorkflowPanel } from "./incident-workflow-panel"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const savedInvestigation = {
  id: "inci-1",
  status: "completed",
  methodology: "Árbol de causas",
  team: [{ userId: "investigador-original", role: "Investigador responsable" }],
  evidenceSummary: "Fotografías del área",
  immediateCauses: ["Contacto con zona de riesgo", "Barrera removida"],
  basicCauses: ["Control físico insuficiente"],
  organizationalCauses: [],
  failedControls: ["Barrera de ingeniería"],
  conclusions: "La barrera no evitó la exposición.",
  miperUpdateRequired: true,
  miperUpdatedAt: "2026-09-20T12:00:00.000Z",
  procedureUpdateRequired: false,
  procedureUpdatedAt: null,
  trainingRequired: true,
  trainingCompletedAt: "2026-09-21T12:00:00.000Z",
}

function renderPanel(investigation: typeof savedInvestigation | null = savedInvestigation) {
  return render(
    <IncidentWorkflowPanel
      incident={{
        id: "inc-1", status: "pending_capa", version: 7, actualSeverity: "serious", potentialSeverity: "critical",
        isFatalOrSerious: false, operationsSuspended: false, evacuated: false, immediateMeasures: null,
      }}
      notifications={[]}
      investigation={investigation}
      capa={[]}
      people={[]}
      responsibles={[]}
      currentUser={{ id: "quien-guarda", name: "Quien guarda" }}
      permissions={["prevention:incidents:investigate"]}
      defaultTargetDate="2026-10-01"
    />,
  )
}

const field = (container: HTMLElement, name: string) =>
  container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement

describe("IncidentWorkflowPanel — investigación", () => {
  /*
   * El formulario solo precargaba metodología y conclusiones, y el servicio
   * guarda lo que recibe: volver a guardar, aunque fuera para sumar una
   * conclusión, borraba las causas, el resumen y las marcas, y devolvía la
   * investigación completa a «en curso».
   */
  it("precarga lo guardado: causas, resumen, marcas y el cierre", () => {
    const { container } = renderPanel()
    expect(field(container, "immediateCauses").value).toBe("Contacto con zona de riesgo\nBarrera removida")
    expect(field(container, "basicCauses").value).toBe("Control físico insuficiente")
    expect(field(container, "failedControls").value).toBe("Barrera de ingeniería")
    expect(field(container, "evidenceSummary").value).toBe("Fotografías del área")
    expect((field(container, "miperUpdateRequired") as HTMLInputElement).checked).toBe(true)
    expect((field(container, "miperUpdated") as HTMLInputElement).checked).toBe(true)
    expect((field(container, "procedureUpdated") as HTMLInputElement).checked).toBe(false)
    expect((field(container, "trainingCompleted") as HTMLInputElement).checked).toBe(true)
    expect((field(container, "complete") as HTMLInputElement).checked).toBe(true)
  })

  it("volver a guardar reenvía lo guardado y el equipo registrado", async () => {
    const { container, getByRole } = renderPanel()
    fireEvent.change(field(container, "reason"), { target: { value: "Se suma la verificación de terreno" } })
    await act(async () => { getByRole("button", { name: "Guardar investigación", hidden: true }).click() })

    await waitFor(() => expect(actions.savePreventionIncidentInvestigationAction).toHaveBeenCalledTimes(1))
    expect(actions.savePreventionIncidentInvestigationAction).toHaveBeenCalledWith(expect.objectContaining({
      team: [{ userId: "investigador-original", role: "Investigador responsable" }],
      immediateCauses: ["Contacto con zona de riesgo", "Barrera removida"],
      failedControls: ["Barrera de ingeniería"],
      evidenceSummary: "Fotografías del área",
      miperUpdated: true,
      trainingCompleted: true,
      complete: true,
    }))
  })

  it("sin investigación previa, el equipo parte con quien guarda", async () => {
    const { container, getByRole } = renderPanel(null)
    fireEvent.change(field(container, "reason"), { target: { value: "Se abre la investigación" } })
    await act(async () => { getByRole("button", { name: "Guardar investigación", hidden: true }).click() })

    await waitFor(() => expect(actions.savePreventionIncidentInvestigationAction).toHaveBeenCalledWith(expect.objectContaining({
      team: [{ userId: "quien-guarda", role: "Investigador responsable" }],
      immediateCauses: [],
      complete: false,
    })))
  })
})

describe("IncidentWorkflowPanel — un envío rechazado", () => {
  /*
   * `<form action={fn}>` reinicia el formulario al terminar, también cuando el
   * servidor rechaza: se perdía lo tecleado y las `Select` no controladas
   * quedaban mostrando una opción y enviando la del montaje.
   */
  it("conserva lo tecleado en la evidencia", async () => {
    const { container, getByRole } = renderPanel()
    fireEvent.change(field(container, "reference"), { target: { value: "DOC-2026-0042" } })
    fireEvent.change(field(container, "description"), { target: { value: "Foto del anclaje" } })
    await act(async () => { getByRole("button", { name: "Agregar evidencia", hidden: true }).click() })

    await waitFor(() => expect(actions.addPreventionIncidentEvidenceAction).toHaveBeenCalledTimes(1))
    expect(field(container, "reference").value).toBe("DOC-2026-0042")
    expect(field(container, "description").value).toBe("Foto del anclaje")
  })
})
