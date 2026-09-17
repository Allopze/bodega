// @vitest-environment jsdom

/**
 * Fase 3, tarea 3.4: el formulario de desvíos por celda.
 *
 * Lo que se fija acá son las tres decisiones que el formulario toma y que no
 * se pueden mover sin romper el servicio:
 *
 *  1. El destino (mes/semana) aparece **sólo** al reprogramar. El schema
 *     (`pdtpDeviationSchema`) rechaza un destino en cualquier otro tipo, así
 *     que mostrarlo siempre produciría un formulario que falla al enviarse.
 *  2. Lo que viaja es la celda completa (actividad, faena, año, mes, semana)
 *     más `kind` y `reason`: son exactamente los campos que
 *     `recordPdtpDeviation` valida.
 *  3. Cada tipo se ofrece sólo a quien tiene su permiso — "no aplica" y
 *     "reprogramar" cambian lo planificado, "no realizada" no.
 */

import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const recordPdtpDeviationAction = vi.fn(async (_formData: FormData) => ({ ok: true }))
const withdrawPdtpDeviationAction = vi.fn(async (_formData: FormData) => ({ ok: true }))

vi.mock("./actions", () => ({
  recordPdtpDeviationAction: (fd: FormData) => recordPdtpDeviationAction(fd),
  withdrawPdtpDeviationAction: (fd: FormData) => withdrawPdtpDeviationAction(fd),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { PdtpDeviationForm, PdtpDeviationList } from "./pdtp-deviation-form"

afterEach(cleanup)
beforeEach(() => {
  recordPdtpDeviationAction.mockClear()
  withdrawPdtpDeviationAction.mockClear()
})

function renderForm(overrides: Partial<React.ComponentProps<typeof PdtpDeviationForm>> = {}) {
  return render(
    <PdtpDeviationForm
      activityId="act-1"
      activityN={7}
      activityName="Charla de seguridad"
      worksiteId="ws-1"
      year={2026}
      defaultMonth={3}
      defaultWeek={2}
      canDeclareNotPerformed
      canManagePlanning
      {...overrides}
    />,
  )
}

/** Abre el diálogo (el formulario vive dentro de un `Dialog`). */
function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /Declarar desvío en la actividad N°7/ }))
}

describe("PdtpDeviationForm", () => {
  it("elegir Reprogramar muestra mes y semana de destino; No realizada no", async () => {
    renderForm()
    openDialog()

    expect(await screen.findByLabelText("No realizada")).toBeInTheDocument()
    expect(screen.queryByLabelText("Mes de destino")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Semana de destino")).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Reprogramada"))
    expect(await screen.findByLabelText("Mes de destino")).toBeInTheDocument()
    expect(screen.getByLabelText("Semana de destino")).toBeInTheDocument()

    // Volver a "No realizada" retira el destino: dejarlo puesto mandaría al
    // servicio un destino que el schema rechaza para ese tipo.
    fireEvent.click(screen.getByLabelText("No realizada"))
    await waitFor(() => expect(screen.queryByLabelText("Mes de destino")).not.toBeInTheDocument())
  })

  it("envía el tipo, el motivo y la celda completa", async () => {
    renderForm()
    openDialog()

    fireEvent.click(await screen.findByLabelText("No realizada"))
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Faena suspendida por alerta meteorológica de la autoridad." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Registrar desvío/ }))

    await waitFor(() => expect(recordPdtpDeviationAction).toHaveBeenCalledTimes(1))
    const sent = recordPdtpDeviationAction.mock.calls[0]![0]
    expect(sent.get("kind")).toBe("not_performed")
    expect(sent.get("reason")).toBe("Faena suspendida por alerta meteorológica de la autoridad.")
    expect(sent.get("activityId")).toBe("act-1")
    expect(sent.get("worksiteId")).toBe("ws-1")
    expect(sent.get("year")).toBe("2026")
    expect(sent.get("month")).toBe("3")
    expect(sent.get("week")).toBe("2")
    // Sin reprogramación no viaja destino, ni siquiera vacío.
    expect(sent.get("targetMonth")).toBeNull()
    expect(sent.get("targetWeek")).toBeNull()
  })

  it("al reprogramar también viaja la celda de destino", async () => {
    renderForm()
    openDialog()

    fireEvent.click(await screen.findByLabelText("Reprogramada"))
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "La actividad se traslada por cambio de turno de la faena." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Registrar desvío/ }))

    await waitFor(() => expect(recordPdtpDeviationAction).toHaveBeenCalledTimes(1))
    const sent = recordPdtpDeviationAction.mock.calls[0]![0]
    expect(sent.get("kind")).toBe("reprogrammed")
    // Por omisión, la semana siguiente de la misma celda: un destino igual al
    // origen lo rechazan tanto el schema como el CHECK de la tabla.
    expect(sent.get("targetMonth")).toBe("3")
    expect(sent.get("targetWeek")).toBe("3")
  })

  it("quien sólo ejecuta no puede sacar la celda del cálculo", async () => {
    renderForm({ canManagePlanning: false })
    openDialog()

    expect(await screen.findByLabelText("No realizada")).toBeInTheDocument()
    expect(screen.queryByLabelText("No aplica")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Reprogramada")).not.toBeInTheDocument()
  })

  it("sin ningún permiso no se ofrece el botón", () => {
    renderForm({ canDeclareNotPerformed: false, canManagePlanning: false })
    expect(screen.queryByRole("button", { name: /Declarar desvío/ })).not.toBeInTheDocument()
  })
})

describe("PdtpDeviationList", () => {
  const deviations = [
    {
      id: "dev-1",
      month: 3,
      week: 2,
      kind: "not_performed",
      reason: "Faena suspendida por alerta meteorológica.",
      targetMonth: null,
      targetWeek: null,
    },
  ]

  it("muestra el tipo en castellano y el motivo, no el enum", () => {
    render(<PdtpDeviationList deviations={deviations} />)
    expect(screen.getByText("No realizada")).toBeInTheDocument()
    expect(screen.getByText("Faena suspendida por alerta meteorológica.")).toBeInTheDocument()
    expect(screen.queryByText("not_performed")).not.toBeInTheDocument()
  })

  it("ofrece 'Retirar' sólo a quien puede operar la celda", () => {
    const { unmount } = render(<PdtpDeviationList deviations={deviations} />)
    expect(screen.queryByRole("button", { name: "Retirar" })).not.toBeInTheDocument()
    unmount()
    render(<PdtpDeviationList deviations={deviations} canWithdraw />)
    expect(screen.getByRole("button", { name: "Retirar" })).toBeInTheDocument()
  })

  it("el retiro exige su propio motivo y viaja con el id del desvío", async () => {
    render(<PdtpDeviationList deviations={deviations} canWithdraw />)
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }))

    fireEvent.change(await screen.findByLabelText("Motivo del retiro"), {
      target: { value: "La faena confirmó que la actividad sí se ejecutó esa semana." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Retirar desvío/ }))

    await waitFor(() => expect(withdrawPdtpDeviationAction).toHaveBeenCalledTimes(1))
    const sent = withdrawPdtpDeviationAction.mock.calls[0]![0]
    expect(sent.get("deviationId")).toBe("dev-1")
    expect(sent.get("reason")).toBe("La faena confirmó que la actividad sí se ejecutó esa semana.")
  })

  it("sin desvíos no dibuja nada", () => {
    const { container } = render(<PdtpDeviationList deviations={[]} canWithdraw />)
    expect(container).toBeEmptyDOMElement()
  })
})
