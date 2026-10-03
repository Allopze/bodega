import { describe, expect, it } from "vitest"
import { isCriticalRisk, isCriticalWithoutControl } from "./critical-control"

const intolerable = { classification: "intolerable", isCritical: false }
const linked = new Set(["c-pdtp"])

describe("riesgo crítico sin control (KPI del tablero y portada MIPER)", () => {
  it("crítico es el Intolerable del RE-04 o, en una fila legacy sin clasificación, la marcada crítica", () => {
    expect(isCriticalRisk(intolerable)).toBe(true)
    expect(isCriticalRisk({ classification: null, isCritical: true })).toBe(true)
    expect(isCriticalRisk({ classification: null, isCritical: false })).toBe(false)
    // Con clasificación RE-04, la marca legacy ya no manda.
    expect(isCriticalRisk({ classification: "important", isCritical: true })).toBe(false)
    expect(isCriticalRisk({ classification: "moderate", isCritical: false })).toBe(false)
  })

  it("un Intolerable sin medidas está sin control", () => {
    expect(isCriticalWithoutControl(intolerable, [], linked)).toBe(true)
  })

  it("le falta una de las dos cosas: medida implementada o verificada, o medida con vínculo PDTP", () => {
    // Implementada pero fuera del PDTP.
    expect(isCriticalWithoutControl(intolerable, [{ id: "c1", status: "implemented" }], linked)).toBe(true)
    // En el PDTP pero sólo propuesta.
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "proposed" }], linked)).toBe(true)
    // Ineficaz o retirada no cuentan como implementada.
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "ineffective" }], linked)).toBe(true)
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "retired" }], linked)).toBe(true)
  })

  it("controlado: alguna medida implementada o verificada y alguna en el PDTP (pueden ser distintas)", () => {
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "verified" }], linked)).toBe(false)
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "implemented" }], linked)).toBe(false)
    expect(isCriticalWithoutControl(intolerable, [{ id: "c1", status: "implemented" }, { id: "c-pdtp", status: "proposed" }], linked)).toBe(false)
  })

  it("lo que no es crítico nunca cuenta", () => {
    expect(isCriticalWithoutControl({ classification: "important", isCritical: false }, [], linked)).toBe(false)
    expect(isCriticalWithoutControl({ classification: null, isCritical: false }, [], linked)).toBe(false)
  })

  it("una fila legacy crítica sin control cuenta", () => {
    expect(isCriticalWithoutControl({ classification: null, isCritical: true }, [{ id: "c1", status: "verified" }], linked)).toBe(true)
  })
})
