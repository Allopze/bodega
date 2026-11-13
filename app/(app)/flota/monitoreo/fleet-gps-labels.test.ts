import { describe, expect, it } from "vitest"
import { alertStatusMeta, gpsSignalLabel, ignitionMeta, linkedEntityLabel } from "./fleet-gps-labels"

describe("etiquetas de Monitoreo GPS", () => {
  it("las alertas dicen su estado en español, nunca el valor de la base", () => {
    expect(alertStatusMeta("blocked")).toEqual({ label: "Requiere atención", variant: "danger" })
    expect(alertStatusMeta("actioned").label).toBe("Atendida")
    expect(alertStatusMeta("algo_nuevo").label).toBe("Algo nuevo")
  })

  it("lo que creó una alerta no se escribe en mayúsculas crudas", () => {
    expect(linkedEntityLabel("capa")).toBe("Acción correctiva creada")
    expect(linkedEntityLabel("work_order")).toBe("Orden de trabajo creada")
    expect(linkedEntityLabel("capa")).not.toMatch(/CAPA/)
  })

  it("la señal traduce los códigos de Wialon y deja el texto libre del portal", () => {
    expect(gpsSignalLabel({ gpsStatus: "sats:7", sourceStatus: null })).toBe("7 satélites")
    expect(gpsSignalLabel({ gpsStatus: "sats:1", sourceStatus: null })).toBe("1 satélite")
    expect(gpsSignalLabel({ gpsStatus: null, sourceStatus: "ignition_unknown" })).toBe("Sin dato de encendido")
    expect(gpsSignalLabel({ gpsStatus: "GPS válido", sourceStatus: null })).toBe("GPS válido")
    expect(gpsSignalLabel({ gpsStatus: null, sourceStatus: null })).toBe("Sin estado GPS")
  })

  it("el encendido distingue apagado de sin dato", () => {
    expect(ignitionMeta({ ignitionKnown: false, ignition: false }).label).toBe("Sin dato")
    expect(ignitionMeta({ ignitionKnown: true, ignition: false }).label).toBe("Apagado")
    expect(ignitionMeta({ ignitionKnown: true, ignition: true })).toEqual({ label: "Encendido", variant: "success" })
  })
})
