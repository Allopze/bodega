import { describe, expect, it } from "vitest"
import { credentialsOriginText, cronOutcomeBadge, INTEGRATION_JOBS, lastRunText } from "./integration-status"

describe("estado de las integraciones en palabras", () => {
  it("dice cómo terminó la última corrida", () => {
    const startedAt = "2026-10-28T08:31:00.000Z"
    expect(lastRunText({ startedAt, outcome: "success" })).toMatch(/^Última corrida: .+ · terminó bien\.$/)
    expect(lastRunText({ startedAt, outcome: "failed" })).toContain("falló")
    expect(lastRunText({ startedAt, outcome: "running" })).toMatch(/^Corriendo desde /)
    expect(lastRunText({ startedAt, outcome: "skipped" })).toContain("había otra en curso")
  })

  it("sin corridas en el último mes lo dice, no deja la línea vacía", () => {
    expect(lastRunText(null)).toBe("No hay corridas en los últimos 30 días.")
    expect(lastRunText({ startedAt: null, outcome: null })).toBe("No hay corridas en los últimos 30 días.")
  })

  it("cada resultado tiene su etiqueta y su variante", () => {
    expect(cronOutcomeBadge("success")).toEqual({ label: "Al día", variant: "success" })
    expect(cronOutcomeBadge("failed")).toEqual({ label: "Falló", variant: "danger" })
    expect(cronOutcomeBadge(null).label).toBe("Sin corridas")
  })

  it("los nombres de las corridas son los de los crons del módulo", () => {
    expect(INTEGRATION_JOBS).toEqual({ copec: "fuel-copec-sync", visionlink: "fuel-visionlink-sync" })
  })
})

describe("origen de las credenciales", () => {
  it("dice si están guardadas en la plataforma, vienen del servidor o son de las dos partes", () => {
    expect(credentialsOriginText(["system_settings", "system_settings"])).toBe("guardadas en la plataforma")
    expect(credentialsOriginText(["environment", "environment", "environment"])).toBe("del servidor")
    expect(credentialsOriginText(["system_settings", "environment"])).toBe("guardadas en la plataforma y del servidor")
  })

  it("un campo faltante no cambia lo que se dice de los demás; sin ninguno no hay origen", () => {
    expect(credentialsOriginText(["missing", "environment"])).toBe("del servidor")
    expect(credentialsOriginText(["missing", "missing"])).toBeNull()
    expect(credentialsOriginText([])).toBeNull()
  })
})
