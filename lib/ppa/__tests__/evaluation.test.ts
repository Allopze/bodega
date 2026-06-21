import { describe, it, expect } from "vitest"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import type { PpaAnswers } from "@/lib/ppa/types"

/** Respuestas base "seguras": tarea NO crítica, todo en orden. */
function safeAnswers(overrides: Partial<PpaAnswers> = {}): PpaAnswers {
  return {
    tipoTrabajo:         "conductor_batea", // no crítica
    cambioPlanificado:   "no",
    peligroNoControlado: "no",
    controles:           ["epp", "herramientas"],
    seguroComenzar:      "si",
    complementarias:     {},
    ...overrides,
  }
}

describe("evaluatePpa", () => {
  it("autoriza cuando no hay condiciones críticas", () => {
    const r = evaluatePpa(safeAnswers())
    expect(r.stop).toBe(false)
    expect(r.resultado).toBe("autorizado_auto")
    expect(r.reasons).toEqual([])
  })

  it("detiene si el trabajador declara que NO es seguro comenzar", () => {
    const r = evaluatePpa(safeAnswers({ seguroComenzar: "no" }))
    expect(r.stop).toBe(true)
    expect(r.resultado).toBe("detenido")
    expect(r.reasons).toContain("no_seguro")
  })

  it("detiene ante un peligro no controlado", () => {
    const r = evaluatePpa(safeAnswers({ peligroNoControlado: "si", peligroDescripcion: "Cable expuesto" }))
    expect(r.stop).toBe(true)
    expect(r.reasons).toContain("peligro_no_controlado")
  })

  it("marca respuesta insuficiente si declara peligro sin describirlo", () => {
    const r = evaluatePpa(safeAnswers({ peligroNoControlado: "si", peligroDescripcion: "" }))
    expect(r.reasons).toContain("peligro_no_controlado")
    expect(r.reasons).toContain("respuesta_insuficiente")
  })

  it("detiene si hay cambio sin describir", () => {
    const r = evaluatePpa(safeAnswers({ cambioPlanificado: "si", cambioDescripcion: "" }))
    expect(r.stop).toBe(true)
    expect(r.reasons).toContain("cambio_sin_descripcion")
  })

  it("no detiene por cambio si lo describe", () => {
    const r = evaluatePpa(safeAnswers({ cambioPlanificado: "si", cambioDescripcion: "Se sumó una excavación" }))
    expect(r.stop).toBe(false)
  })

  it("detiene si faltan controles requeridos", () => {
    const r = evaluatePpa(safeAnswers({ controles: ["epp"] })) // falta herramientas
    expect(r.stop).toBe(true)
    expect(r.reasons).toContain("faltan_controles")
  })

  it("marca tarea crítica y exige el peligro crítico", () => {
    const r = evaluatePpa(safeAnswers({
      tipoTrabajo: "operador_maquinaria_pesada", // crítica
      complementarias: { queCambio: "nada relevante", revisionEquipo: "frenos ok", condicionClima: "despejado" },
    }))
    expect(r.esCritica).toBe(true)
    expect(r.stop).toBe(true)
    expect(r.reasons).toContain("sin_peligro_en_tarea_critica")
  })

  it("autoriza tarea crítica con todas las complementarias respondidas", () => {
    const r = evaluatePpa(safeAnswers({
      tipoTrabajo: "operador_maquinaria_pesada",
      complementarias: {
        peligroCritico: "Volcamiento en pendiente",
        queCambio:      "Terreno más húmedo",
        revisionEquipo: "Revisé frenos y luces",
        condicionClima: "Lluvia leve, controlada",
      },
    }))
    expect(r.esCritica).toBe(true)
    expect(r.stop).toBe(false)
  })

  it("acumula múltiples razones sin duplicarlas", () => {
    const r = evaluatePpa(safeAnswers({
      seguroComenzar: "no",
      peligroNoControlado: "si",
      peligroDescripcion: "",
      controles: [],
    }))
    expect(r.reasons).toContain("no_seguro")
    expect(r.reasons).toContain("peligro_no_controlado")
    expect(r.reasons).toContain("faltan_controles")
    // sin duplicados
    expect(new Set(r.reasons).size).toBe(r.reasons.length)
  })
})
