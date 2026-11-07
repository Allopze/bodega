// @vitest-environment jsdom

import type * as React from "react"
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

function renderPanel(overrides: Partial<React.ComponentProps<typeof IncidentWorkflowPanel>> = {}) {
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
      {...overrides}
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

describe("IncidentWorkflowPanel — fechas con el DatePicker del sistema (A6)", () => {
  const person = {
    id: "p-1", displayLabel: "Persona uno", absenceAtLeastNormalShift: true, absenceDays: 0,
    absenceStartDate: "2026-09-02", returnToWorkDate: null, chargeDays: 0, administratorQualification: null,
    indicatorInclusionStatus: "pending", version: 1,
  }

  it("el reposo se envía con los mismos nombres y formato ISO que el `<input type=date>`", async () => {
    const { container } = renderPanel({ people: [person] })
    expect(container.querySelector('input[type="date"]')).toBeNull()
    expect(field(container, "absenceStartDate")).toMatchObject({ type: "hidden", value: "2026-09-02" })
    expect(field(container, "returnToWorkDate")).toMatchObject({ type: "hidden", value: "" })

    fireEvent.change(field(container, "reason"), { target: { value: "Resolución revisada y criterio aplicado" } })
    await act(async () => { field(container, "absenceStartDate").closest("form")!.requestSubmit() })
    await waitFor(() => expect(actions.classifyIncidentPersonForIndicatorsAction).toHaveBeenCalledTimes(1))
    expect((actions.classifyIncidentPersonForIndicatorsAction.mock.calls as unknown[][])[0]![0]).toMatchObject({
      absencePeriods: [{ startDate: "2026-09-02", endDate: null }],
    })
  })

  it("autorizar el reinicio no se habilita sin la fecha de la autorización", () => {
    const { container, getByRole } = renderPanel({
      incident: {
        id: "inc-1", status: "pending_capa", version: 7, actualSeverity: "serious", potentialSeverity: "critical",
        isFatalOrSerious: true, operationsSuspended: true, evacuated: false, immediateMeasures: null,
      },
      permissions: ["prevention:incidents:authorize_restart"],
    })
    expect(container.querySelector('input[type="date"]')).toBeNull()
    expect(field(container, "authorizationDate")).toMatchObject({ type: "hidden", value: "" })
    expect(getByRole("button", { name: "Autorizar reinicio" })).toBeDisabled()
  })
})
