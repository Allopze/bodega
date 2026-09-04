/**
 * lib/__tests__/identificacion-sensibles-definition.test.ts
 *
 * El RE-28 como instrumento del motor de evaluaciones.
 *
 * Lo que estos casos protegen no es el contenido del formulario sino tres
 * decisiones que son fáciles de deshacer sin darse cuenta: que la declaración
 * de salud no se puntúe, que el registro no programe seguimientos, y que la
 * definición viva en Evaluaciones y no en Inspecciones.
 */

import { describe, expect, it } from "vitest"
import {
  CHECKLIST_DEFINITIONS,
  PERSON_EVALUATION_DEFINITION_CODES,
  isPersonEvaluationDefinition,
} from "@/lib/sst/definitions"
import { IDENTIFICACION_SENSIBLES } from "@/lib/sst/definitions/identificacion-sensibles"
import { getApplicableItems } from "@/lib/sst/checklist"
import { getAutomaticResultadoFinal } from "@/lib/sst/compliance"

describe("IDENTIFICACION_SENSIBLES", () => {
  it("está registrada en el catálogo con su código y versión", () => {
    expect(CHECKLIST_DEFINITIONS["identificacion_sensibles"]).toBe(IDENTIFICACION_SENSIBLES)
    expect(IDENTIFICACION_SENSIBLES.code).toBe("identificacion_sensibles")
    expect(IDENTIFICACION_SENSIBLES.version).toBe("01")
  })

  it("es una evaluación de persona, no una inspección", () => {
    // Estar en esta lista hace las dos cosas de una vez: la habilita en
    // /prevencion/nueva y la mantiene fuera del catálogo de inspecciones, que
    // es donde un registro de datos de salud no debe estar.
    expect(isPersonEvaluationDefinition("identificacion_sensibles")).toBe(true)
    expect(PERSON_EVALUATION_DEFINITION_CODES).toContain("identificacion_sensibles")
  })

  it("no programa los seguimientos de día 0/7/15/30", () => {
    // Comparte `tipo: 'seguimiento'` con el control post-incidente y no comparte
    // su cadencia: es un registro de una sola vez, con su reevaluación acordada
    // dentro del propio formulario.
    expect(IDENTIFICACION_SENSIBLES.tipo).toBe("seguimiento")
    expect(IDENTIFICACION_SENSIBLES.schedulesFollowups).toBe(false)
  })

  it("transcribe las ocho categorías del formulario, ni una más ni una menos", () => {
    // El formulario es el de Chome, no una reconstrucción desde la norma: si
    // alguien agrega una categoría "razonable" que el papel no tiene, el acta
    // deja de ser transcripción y el respaldo documental se separa del sistema.
    const categorias = IDENTIFICACION_SENSIBLES.sections
      .find((s) => s.id === "categorias_sensibilidad")!
      .items.filter((item) => item.kind === "si_no_obs")
      .map((item) => item.id)
    expect(categorias).toEqual([
      "embarazo_lactancia",
      "menor_edad",
      "enfermedad_cronica",
      "inmunocomprometida",
      "discapacidad",
      "tratamiento_farmacologico",
      "alergias",
      "otra_condicion",
    ])
  })

  it("la evaluación del puesto son las tres preguntas del formulario", () => {
    const preguntas = IDENTIFICACION_SENSIBLES.sections
      .find((s) => s.id === "evaluacion_puesto")!
      .items.filter((item) => item.kind === "si_no_obs")
      .map((item) => item.id)
    expect(preguntas).toEqual(["exposicion_agentes", "requiere_ajuste", "monitoreo_medico"])
  })

  it("no tiene un solo ítem puntuable", () => {
    // El RE-28 no tiene columna cumple/no cumple. Marcar las secciones como
    // puntuables tenía un efecto absurdo: "No" es un estado negativo, así que
    // el cierre exigía una observación escrita por cada categoría respondida
    // "No" — once justificaciones para decir que la persona no está embarazada
    // ni es menor de edad. Mismo molde que la observación planeada del Anexo 7.
    for (const section of IDENTIFICACION_SENSIBLES.sections) {
      expect(section.countsForCompliance, section.id).toBe(false)
    }
    expect(getApplicableItems(IDENTIFICACION_SENSIBLES, [])).toHaveLength(0)
  })

  it("ninguna sección queda atrapada por la regla del conductor líder", () => {
    // `sectionAppliesToEvaluatorRole` trata cualquier `requiresPermission` como
    // sección exclusiva del Punto 3 del conductor líder, así que marcarla acá la
    // dejaría fuera del formulario para todos los demás evaluadores.
    expect(IDENTIFICACION_SENSIBLES.sections.every((s) => !s.requiresPermission)).toBe(true)
  })

  it("su resultado sale de las respuestas, no del porcentaje", () => {
    // El porcentaje es siempre 0 porque nada puntúa; si el resultado dependiera
    // de él, toda persona quedaría con restricciones.
    const sinCondicion = getAutomaticResultadoFinal("identificacion_sensibles", 0, [
      { seccionId: "evaluacion_puesto", itemId: "exposicion_agentes", estado: "no" },
      { seccionId: "evaluacion_puesto", itemId: "requiere_ajuste", estado: "no" },
    ])
    expect(sinCondicion).toBe("habilitado_autonomo")

    const conAjuste = getAutomaticResultadoFinal("identificacion_sensibles", 0, [
      { seccionId: "evaluacion_puesto", itemId: "exposicion_agentes", estado: "no" },
      { seccionId: "evaluacion_puesto", itemId: "requiere_ajuste", estado: "si" },
    ])
    expect(conAjuste).toBe("habilitado_restricciones")

    const conExposicion = getAutomaticResultadoFinal("identificacion_sensibles", 0, [
      { seccionId: "evaluacion_puesto", itemId: "exposicion_agentes", estado: "si" },
      { seccionId: "evaluacion_puesto", itemId: "requiere_ajuste", estado: "no" },
    ])
    expect(conExposicion).toBe("habilitado_restricciones")
  })

  it("declara la cadencia semestral que fija el procedimiento DO-47", () => {
    expect(IDENTIFICACION_SENSIBLES.frequencySuggested).toMatch(/6 meses/i)
  })

  it("su acta de cierre declara resultados y firmantes", () => {
    expect(IDENTIFICACION_SENSIBLES.closingAct?.resultOptions.length).toBeGreaterThan(0)
    expect(IDENTIFICACION_SENSIBLES.closingAct?.signatureRoles).toContain("prevencionista")
  })
})
