// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SaveStatusIndicator } from "./save-status"

describe("SaveStatusIndicator", () => {
  it("anuncia la hora del último guardado en reloj de 24 horas, como el resto de la plataforma", () => {
    // 21:49 UTC del 2 de octubre de 2026 = 18:49 en Santiago (UTC-3 en horario de verano).
    render(<SaveStatusIndicator editable status={{ state: "saved", savedAt: Date.UTC(2026, 9, 2, 21, 49), message: null }} />)
    expect(screen.getByRole("status").textContent).toBe("Guardado a las 18:49")
  })
  it("con un rechazo anuncia el motivo", () => {
    render(<SaveStatusIndicator editable status={{ state: "error", savedAt: null, message: "La fila cambió mientras la editabas" }} />)
    expect(screen.getByRole("status").textContent).toBe("No se guardó: La fila cambió mientras la editabas")
  })
})
