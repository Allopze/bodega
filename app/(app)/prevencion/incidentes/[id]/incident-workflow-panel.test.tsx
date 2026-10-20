// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  addPreventionIncidentEvidenceAction: vi.fn(async () => ({ ok: false, message: "La referencia no es verificable." })),
  authorizePreventionIncidentRestartAction: vi.fn(async () => ({ ok: true })),
  classifyIncidentPersonForIndicatorsAction: vi.fn(async () => ({ ok: true })),
  createPreventionIncidentCapaAction: vi.fn(async () => ({ ok: true })),
  recordPreventionIncidentNotificationAction: vi.fn(async () => ({ ok: true })),
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

function renderPanel() {
  return render(
    <IncidentWorkflowPanel
      incident={{
        id: "inc-1", status: "pending_capa", version: 7, actualSeverity: "serious", potentialSeverity: "critical",
        isFatalOrSerious: false, operationsSuspended: false, evacuated: false, immediateMeasures: null,
      }}
      notifications={[]}
      capa={[]}
      people={[]}
      responsibles={[]}
      permissions={["prevention:incidents:investigate"]}
      defaultTargetDate="2026-10-01"
    />,
  )
}

const field = (container: HTMLElement, name: string) =>
  container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement

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
