import { describe, expect, it } from "vitest"
import { evaluatePpa } from "./evaluation"
import type { PpaAnswers } from "./types"

function baseAnswers(overrides: Partial<PpaAnswers> = {}): PpaAnswers {
  return {
    tipoTrabajo: "conductor_ampliroll",
    cambioPlanificado: "no",
    peligroNoControlado: "no",
    controles: ["epp", "herramientas"],
    seguroComenzar: "si",
    complementarias: {},
    ...overrides,
  }
}

describe("evaluatePpa", () => {
  it("autoriza un PPA con todas las respuestas correctas", () => {
    const result = evaluatePpa(baseAnswers())
    expect(result.stop).toBe(false)
    expect(result.resultado).toBe("autorizado_auto")
    expect(result.reasons).toHaveLength(0)
  })

  it("detiene si seguroComenzar es 'no'", () => {
    const result = evaluatePpa(baseAnswers({ seguroComenzar: "no" }))
    expect(result.stop).toBe(true)
    expect(result.resultado).toBe("detenido")
    expect(result.reasons).toContain("no_seguro")
  })

  it("detiene si peligroNoControlado es 'si'", () => {
    const result = evaluatePpa(baseAnswers({
      peligroNoControlado: "si",
      peligroDescripcion: "Cables sueltos en zona de trabajo",
    }))
    expect(result.stop).toBe(true)
    expect(result.reasons).toContain("peligro_no_controlado")
  })

  it("detiene si peligro declarado pero no descrito suficientemente", () => {
    const result = evaluatePpa(baseAnswers({
      peligroNoControlado: "si",
      peligroDescripcion: "ab",
    }))
    expect(result.stop).toBe(true)
    expect(result.reasons).toContain("peligro_no_controlado")
    expect(result.reasons).toContain("respuesta_insuficiente")
  })

  it("detiene si cambioPlanificado sin descripción", () => {
    const result = evaluatePpa(baseAnswers({
      cambioPlanificado: "si",
      cambioDescripcion: "",
    }))
    expect(result.stop).toBe(true)
    expect(result.reasons).toContain("cambio_sin_descripcion")
  })

  it("detiene si faltan controles requeridos", () => {
    const result = evaluatePpa(baseAnswers({ controles: ["herramientas"] }))
    expect(result.stop).toBe(true)
    expect(result.reasons).toContain("faltan_controles")
  })

  describe("tareas críticas", () => {
    it("detiene si no identifica peligro crítico en tarea crítica", () => {
      const result = evaluatePpa(baseAnswers({
        tipoTrabajo: "operador_maquinaria_pesada",
        complementarias: { peligroCritico: "" },
      }))
      expect(result.stop).toBe(true)
      expect(result.reasons).toContain("sin_peligro_en_tarea_critica")
    })

    it("detiene si peligro crítico es insuficiente", () => {
      const result = evaluatePpa(baseAnswers({
        tipoTrabajo: "operador_maquinaria_pesada",
        complementarias: { peligroCritico: "abc" },
      }))
      expect(result.stop).toBe(true)
      expect(result.reasons).toContain("sin_peligro_en_tarea_critica")
    })

    it("detiene si falta una pregunta complementaria obligatoria", () => {
      const result = evaluatePpa(baseAnswers({
        tipoTrabajo: "operador_maquinaria_pesada",
        complementarias: {
          peligroCritico: "Vuelco del equipo en terreno inestable",
          queCambio: "Lluvia reciente, terreno más blando",
          revisionEquipo: "",  // faltante
          condicionClima: "Viento moderado, sin lluvia activa",
        },
      }))
      expect(result.stop).toBe(true)
      expect(result.reasons).toContain("pregunta_critica_sin_responder")
    })

    it("detiene si respuesta complementaria es insuficiente", () => {
      const result = evaluatePpa(baseAnswers({
        tipoTrabajo: "operador_maquinaria_pesada",
        complementarias: {
          peligroCritico: "Vuelco del equipo en terreno inestable",
          queCambio: "ab",  // demasiado corto (<4 chars)
          revisionEquipo: "Revisé niveles de aceite y frenos",
          condicionClima: "ok",  // demasiado corto
        },
      }))
      expect(result.stop).toBe(true)
      expect(result.reasons).toContain("respuesta_insuficiente")
    })

    it("autoriza tarea crítica con todas las complementarias bien respondidas", () => {
      const result = evaluatePpa(baseAnswers({
        tipoTrabajo: "operador_maquinaria_pesada",
        complementarias: {
          peligroCritico: "Vuelco del equipo en terreno inestable",
          queCambio: "Lluvia reciente dejó el terreno más blando",
          revisionEquipo: "Revisé niveles de aceite, frenos y luces",
          condicionClima: "Viento moderado, sin lluvia activa",
        },
      }))
      expect(result.stop).toBe(false)
      expect(result.resultado).toBe("autorizado_auto")
      expect(result.esCritica).toBe(true)
    })
  })
})
