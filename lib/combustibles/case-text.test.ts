import { describe, expect, it } from "vitest"
import { meterJumpText, readableCaseText, readableCaseValue, regressiveReadingText, stationNameText } from "./case-text"

/**
 * El texto de los casos con cifras legibles (crítica 2026-11-15, paso 8): los casos
 * guardados decían «(35551)» y la estación de Copec en mayúsculas.
 */
describe("texto de los casos de combustible", () => {
  it("reescribe una lectura regresiva de Copec guardada con la plantilla vieja", () => {
    expect(readableCaseText("Lectura de odómetro (1) de la carga de JFDB-87 en 2794-LOS CARRERA, ESQ. LAUTARO es menor que la carga anterior (35551)."))
      .toBe("Lectura de odómetro de la carga de JFDB-87 en 2794-Los Carrera, Esq. Lautaro: 1 km, menor que la carga anterior (35.551 km).")
  })

  it("reescribe las del log operacional y las cargas manuales, con su unidad", () => {
    expect(readableCaseText("Lectura de horómetro (1520.5) del log operacional de GR-08 es menor que la carga anterior (15210)."))
      .toBe("Lectura de horómetro del log operacional de GR-08: 1.520,5 h, menor que la carga anterior (15.210 h).")
    expect(readableCaseText("Lectura de odómetro (120400) de la carga de KA-71 es menor que la carga anterior (120900)."))
      .toBe("Lectura de odómetro de la carga de KA-71: 120.400 km, menor que la carga anterior (120.900 km).")
  })

  it("una carga de Copec sin estación lo dice", () => {
    expect(readableCaseText("Lectura de odómetro (10) de la carga de KA-71 en estación no informada es menor que la carga anterior (20)."))
      .toBe("Lectura de odómetro de la carga de KA-71 en estación no informada: 10 km, menor que la carga anterior (20 km).")
  })

  it("el detector escribe lo mismo que la reescritura, y reescribir dos veces no cambia nada", () => {
    const fresh = regressiveReadingText({ meter: "km", reading: 1, previous: 35551, plate: "JFDB-87", source: "load", station: "2794-LOS CARRERA, ESQ. LAUTARO" })
    expect(fresh).toBe(readableCaseText("Lectura de odómetro (1) de la carga de JFDB-87 en 2794-LOS CARRERA, ESQ. LAUTARO es menor que la carga anterior (35551)."))
    expect(readableCaseText(fresh)).toBe(fresh)
  })

  it("«1 día(s)» pasa a singular o plural", () => {
    expect(readableCaseText("Lectura de odómetro de WK-5867 sube 3.361 km en 1 día(s) (3.361 km/día): supera lo posible para el equipo."))
      .toBe("Lectura de odómetro de WK-5867 sube 3.361 km en 1 día (3.361 km/día): supera lo posible para el equipo.")
    expect(meterJumpText({ meter: "hora", plate: "CR-35", delta: 96, days: 2, ratePerDay: 48 }))
      .toBe("Lectura de horómetro de CR-35 sube 96 h en 2 días (48 h/día): supera lo posible para el equipo.")
  })

  it("una variación de consumo lleva separador de miles", () => {
    expect(readableCaseText("Consumo varió 1191% respecto al período anterior (2.889,95 L vs 223,84 L)."))
      .toBe("Consumo varió 1.191% respecto al período anterior (2.889,95 L vs 223,84 L).")
  })

  it("un texto que no calza con ninguna plantilla se muestra tal cual", () => {
    const free = "Carga registrada 5 días después de ocurrida (12345)."
    expect(readableCaseText(free)).toBe(free)
  })

  it("una estación que ya trae minúsculas no se toca; los conectores van en minúscula", () => {
    expect(stationNameText("Estación Los Ángeles")).toBe("Estación Los Ángeles")
    expect(stationNameText("AV. PEDRO DE VALDIVIA Y LOS LEONES")).toBe("Av. Pedro de Valdivia y Los Leones")
    expect(stationNameText("2501-RUTA Q 50, KM 11 DESDE  CABRERO")).toBe("2501-Ruta Q 50, Km 11 Desde Cabrero")
  })

  it("observado y esperado con separador de miles", () => {
    expect(readableCaseValue("35551")).toBe("35.551")
    expect(readableCaseValue("> 35551")).toBe("> 35.551")
    expect(readableCaseValue("≤ 120400")).toBe("≤ 120.400")
    expect(readableCaseValue("entre 2,39 y 2,81")).toBe("entre 2,39 y 2,81")
  })
})
