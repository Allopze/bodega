// @vitest-environment jsdom

/**
 * Fase 4, tarea 4.4: el botón de cierre mensual.
 *
 * Lo que se fija acá son las dos decisiones que el formulario toma y que no se
 * pueden mover sin romper el servicio ni el uso real:
 *
 *  1. El mes por defecto es **el anterior**, en hora de Chile. El mes en curso
 *     todavía está ocurriendo y `closePdtpPeriod` lo rechaza si aún no
 *     terminó; ofrecerlo por defecto invitaría a congelar un mes a medias.
 *  2. El motivo es obligatorio con al menos 10 caracteres — el mismo mínimo
 *     que el schema y que el CHECK de la tabla, así que un botón habilitado
 *     antes de eso sólo produce un error de servidor.
 */

import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const closePdtpPeriodAction = vi.fn(async (_input: unknown) => ({ ok: true }))

vi.mock("../actions", () => ({
  closePdtpPeriodAction: (input: unknown) => closePdtpPeriodAction(input),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { PdtpPeriodCloseButton, defaultPdtpClosureMonth } from "./period-close-button"

afterEach(cleanup)
beforeEach(() => closePdtpPeriodAction.mockClear())

function renderButton(overrides: Partial<React.ComponentProps<typeof PdtpPeriodCloseButton>> = {}) {
  return render(
    <PdtpPeriodCloseButton
      programId="prog-1"
      worksiteId="ws-1"
      year={2026}
      now={new Date("2026-04-15T12:00:00.000Z")}
      {...overrides}
    />,
  )
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /cerrar mes/i }))
}

describe("defaultPdtpClosureMonth", () => {
  it("es el mes anterior en hora de Chile", () => {
    expect(defaultPdtpClosureMonth(new Date("2026-04-15T12:00:00.000Z"))).toBe(3)
  })

  it("en enero cae en diciembre", () => {
    expect(defaultPdtpClosureMonth(new Date("2026-01-10T12:00:00.000Z"))).toBe(12)
  })

  it("usa el día chileno, no el UTC: el 1 de mayo a las 01:00 UTC todavía es 30 de abril en Chile", () => {
    // 2026-05-01T01:00Z = 2026-04-30 21:00 en Chile → el mes anterior es marzo.
    expect(defaultPdtpClosureMonth(new Date("2026-05-01T01:00:00.000Z"))).toBe(3)
  })
})

describe("PdtpPeriodCloseButton", () => {
  it("abre el diálogo con el selector de mes y el fundamento", async () => {
    renderButton()
    openDialog()

    // Cuál es el mes preseleccionado se verifica sobre lo que se ENVÍA (más
    // abajo), no sobre el texto del disparador del `Select`: eso depende de
    // cómo Radix pinte el valor en jsdom, no del contrato del formulario.
    await waitFor(() => expect(screen.getByLabelText("Mes que se cierra")).toBeTruthy())
    expect(screen.getByLabelText("Fundamento del cierre")).toBeTruthy()
  })

  it("mantiene el botón deshabilitado hasta que el motivo tenga 10 caracteres", async () => {
    renderButton()
    openDialog()

    const buttons = await screen.findAllByRole("button", { name: /cerrar mes/i })
    const submit = buttons[buttons.length - 1]!
    expect(submit).toHaveProperty("disabled", true)

    fireEvent.change(screen.getByLabelText("Fundamento del cierre"), { target: { value: "corto" } })
    expect(submit).toHaveProperty("disabled", true)

    fireEvent.change(screen.getByLabelText("Fundamento del cierre"), {
      target: { value: "Evidencias revisadas con la jefatura de faena." },
    })
    expect(submit).toHaveProperty("disabled", false)
  })

  it("envía programa, faena, año, mes, motivo y la casilla de distribución", async () => {
    renderButton()
    openDialog()

    fireEvent.change(await screen.findByLabelText("Fundamento del cierre"), {
      target: { value: "Evidencias revisadas con la jefatura de faena." },
    })
    const buttons = screen.getAllByRole("button", { name: /cerrar mes/i })
    fireEvent.click(buttons[buttons.length - 1]!)

    await waitFor(() => expect(closePdtpPeriodAction).toHaveBeenCalledTimes(1))
    expect(closePdtpPeriodAction).toHaveBeenCalledWith({
      programId: "prog-1",
      worksiteId: "ws-1",
      year: 2026,
      month: 3,
      reason: "Evidencias revisadas con la jefatura de faena.",
      distribute: true,
    })
  })

  it("permite cerrar sin avisar por correo", async () => {
    renderButton()
    openDialog()

    fireEvent.change(await screen.findByLabelText("Fundamento del cierre"), {
      target: { value: "Cierre administrativo sin distribución externa." },
    })
    fireEvent.click(screen.getByLabelText(/Avisar por correo/i))
    const buttons = screen.getAllByRole("button", { name: /cerrar mes/i })
    fireEvent.click(buttons[buttons.length - 1]!)

    await waitFor(() => expect(closePdtpPeriodAction).toHaveBeenCalledTimes(1))
    expect(closePdtpPeriodAction).toHaveBeenCalledWith(expect.objectContaining({ distribute: false }))
  })
})
