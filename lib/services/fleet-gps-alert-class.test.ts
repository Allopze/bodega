import { describe, expect, it } from "vitest"
import { classifyGpsAlert, COUNTED_GPS_ALERT_CLASSES, isCountedGpsAlertClass } from "./fleet-gps-alert-class"

describe("classifyGpsAlert", () => {
  it.each([
    ["El dispositivo KA-144 ha excedido la velocidad en segmento vial, límite de 50 km/h.", "speeding"],
    ["El vehículo KA-12 excedió la velocidad permitida", "speeding"],
    ["Exceso de velocidad, dispositivo GR-11", "speeding"],
    ["El dispositivo KA-140 tiene alerta de bache.", "pothole"],
    ["El dispositivo KA-140 detectó baches en la ruta", "pothole"],
    ["El dispositivo KA-9 frenó bruscamente", "harsh_driving"],
    ["El dispositivo KA-9 aceleró bruscamente", "harsh_driving"],
    ["Inicio de ralentí, dispositivo KA-138", "idle"],
    ["INICIO DE RALENTI, dispositivo KA-138", "idle"],
    ["Fin de ralentí, dispositivo KA-138", "operational"],
    ["El vehículo KA-83 fue apagado", "operational"],
    ["El vehículo KA-83 fue encendido", "operational"],
    ["El dispositivo KA-83 se movió", "operational"],
    ["El dispositivo KA-83 se detuvo", "operational"],
    ["Batería baja en el dispositivo KA-1", "other"],
    ["", "other"],
  ])("%s -> %s", (title, expected) => {
    expect(classifyGpsAlert(title)).toBe(expected)
  })

  it("tolera null y undefined", () => {
    expect(classifyGpsAlert(null)).toBe("other")
    expect(classifyGpsAlert(undefined)).toBe("other")
  })

  it("el límite de velocidad con otra cifra sigue siendo exceso", () => {
    expect(classifyGpsAlert("... límite de 30 km/h.")).toBe("speeding")
  })

  it("las operacionales no se cuentan y las demás sí", () => {
    expect(isCountedGpsAlertClass("operational")).toBe(false)
    for (const cls of COUNTED_GPS_ALERT_CLASSES) expect(isCountedGpsAlertClass(cls)).toBe(true)
  })
})
