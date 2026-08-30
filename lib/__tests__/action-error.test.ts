import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}))

import { safeActionMessage } from "@/lib/action-error"

describe("safeActionMessage", () => {
  const fallback = "No se pudo completar la acción"

  it("preserva un mensaje breve y accionable de negocio", () => {
    expect(safeActionMessage(new Error("El período ya está cerrado"), fallback))
      .toBe("El período ya está cerrado")
  })

  it("oculta SQL y parámetros aunque el wrapper no exponga query", () => {
    const error = new Error(
      'Failed query: insert into "system_settings" ("key", "value") values ($1, $2)\nparams: combustibles.copec.sync,{"cursor":"2026-08"}',
    )

    expect(safeActionMessage(error, fallback)).toBe(fallback)
  })

  it("oculta errores de driver envueltos", () => {
    const error = new Error("No se pudo guardar", {
      cause: Object.assign(new Error("foreign key violation"), { code: "23503" }),
    })

    expect(safeActionMessage(error, fallback)).toBe(fallback)
  })

  it("oculta el JSON interno de errores de esquema", () => {
    const error = Object.assign(new Error('[{"code":"invalid_type","path":["rut"]}]'), {
      issues: [{ code: "invalid_type", path: ["rut"] }],
    })

    expect(safeActionMessage(error, fallback)).toBe(fallback)
  })

  it("recorta el Call log de automatización y conserva el motivo", () => {
    const error = new Error("El portal rechazó las credenciales\nCall log:\n  - waiting for locator('button')")

    expect(safeActionMessage(error, fallback)).toBe("El portal rechazó las credenciales")
  })

  it("no envía mensajes desproporcionados al toast", () => {
    expect(safeActionMessage(new Error("x".repeat(2_000)), fallback)).toBe(fallback)
  })
})
