import { TRABAJADOR_NUEVO } from './trabajador-nuevo'
import { TRABAJADOR_ANTIGUO } from './trabajador-antiguo'
import { INSPECCION_TALLER } from './inspeccion-taller'
import { OBSERVACION_PLANEADA } from './observacion-planeada'
import { INSPECCION_EXTINTORES } from './inspeccion-extintores'
import { INSPECCION_CONTENEDORES } from './inspeccion-contenedores'
import { INSPECCION_CARROS } from './inspeccion-carros'
import { INSPECCION_EQUIPOS_MOVILES } from './inspeccion-equipos-moviles'
import { INSPECCION_EPP } from './inspeccion-epp'
import { OBSERVACION_AMPLIROLL } from './observacion-ampliroll'
import { OBSERVACION_MAQUINARIA } from './observacion-maquinaria'
import { OBSERVACION_CONDUCTAS } from './observacion-conductas'
import { INSPECCION_AREA } from './inspeccion-area'
import { CAMINATA_SEGURIDAD } from './caminata-seguridad'
import { AUDITORIA_SGSST } from './auditoria-sgsst'
import { REPORTE_EQUIPOS } from './reporte-equipos'
import type { ChecklistDefinition } from '../types'

/**
 * Las evaluaciones SST vigentes tienen como sujeto a una persona. Las
 * inspecciones permanecen disponibles para el flujo PDTP, pero no deben
 * aparecer ni poder crearse desde el formulario de Evaluaciones.
 */
export const PERSON_EVALUATION_DEFINITION_CODES = [
  'trabajador_nuevo',
  'trabajador_antiguo',
] as const

export function isPersonEvaluationDefinition(code: string): code is typeof PERSON_EVALUATION_DEFINITION_CODES[number] {
  return (PERSON_EVALUATION_DEFINITION_CODES as readonly string[]).includes(code)
}

/**
 * Definiciones que se conservan en el catálogo pero **no son instrumentos del
 * motor de inspecciones**.
 *
 * Distinto de `PERSON_EVALUATION_DEFINITION_CODES`, que marca lo que pertenece
 * al módulo de Evaluaciones: esto marca lo que no encaja en un motor que
 * calcula cumplimiento y deriva hallazgos.
 *
 * `observacion_planeada` (Anexo 7) es el caso: un relato libre firmado por
 * observador y trabajador, sin un solo ítem puntuable. En Inspecciones su
 * `compliancePercent` es siempre null y `deriveFindings` no puede levantar
 * ningún hallazgo, porque no hay respuesta que pueda ser 'no cumple'. Ocupaba
 * sitio en el catálogo sin aportar ninguna de las dos cosas que el módulo
 * hace. La definición se conserva: el Anexo 7 sigue siendo el formulario de la
 * actividad PDTP n=39, que pasa a acreditarse a mano.
 */
export const NON_INSPECTION_DEFINITION_CODES = [
  'observacion_planeada',
] as const

export function isNonInspectionDefinition(code: string): boolean {
  return (NON_INSPECTION_DEFINITION_CODES as readonly string[]).includes(code)
}

export const CHECKLIST_DEFINITIONS: Record<string, ChecklistDefinition> = {
  'trabajador_nuevo': TRABAJADOR_NUEVO,
  'trabajador_antiguo': TRABAJADOR_ANTIGUO,
  'inspeccion_taller': INSPECCION_TALLER,
  'observacion_planeada': OBSERVACION_PLANEADA,
  'inspeccion_extintores': INSPECCION_EXTINTORES,
  'inspeccion_contenedores': INSPECCION_CONTENEDORES,
  'inspeccion_carros': INSPECCION_CARROS,
  'inspeccion_equipos_moviles': INSPECCION_EQUIPOS_MOVILES,
  // Reporte diario por equipo y turno (PDTP n=25/28). Distinto de
  // `inspeccion_equipos_moviles` (n=33), que es mensual y la hace Prevención.
  'reporte_equipos': REPORTE_EQUIPOS,
  'inspeccion_epp': INSPECCION_EPP,
  'observacion_ampliroll': OBSERVACION_AMPLIROLL,
  'observacion_maquinaria': OBSERVACION_MAQUINARIA,
  // Se importa con kind='audit' en el motor de inspecciones (DS 44 art. 22 n°4).
  'auditoria_sgsst': AUDITORIA_SGSST,
  /* Instrumentos que NO puntúan ítems: registran la actividad y sus
   * desviaciones, tomadas del catálogo de cada uno (`recordsDeviations`). Son
   * las tres actividades del programa que no son una lista de preguntas —n=39
   * conductas, n=40 áreas, n=41 caminata—, y que hasta ahora se acreditaban a
   * mano porque el motor sólo sabía derivar hallazgos de un "no cumple". */
  'observacion_conductas': OBSERVACION_CONDUCTAS,
  'inspeccion_area': INSPECCION_AREA,
  'caminata_seguridad': CAMINATA_SEGURIDAD,
}

export function getDefinition(code: string, _version?: string): ChecklistDefinition {
  const def = CHECKLIST_DEFINITIONS[code]
  if (!def) throw new Error(`Unknown checklist definition: ${code}`)
  return def
}

export {
  TRABAJADOR_NUEVO, TRABAJADOR_ANTIGUO, INSPECCION_TALLER, OBSERVACION_PLANEADA,
  INSPECCION_EXTINTORES, INSPECCION_CONTENEDORES, INSPECCION_CARROS,
  INSPECCION_EQUIPOS_MOVILES, INSPECCION_EPP,
  OBSERVACION_AMPLIROLL, OBSERVACION_MAQUINARIA,
  AUDITORIA_SGSST, REPORTE_EQUIPOS,
  OBSERVACION_CONDUCTAS, INSPECCION_AREA, CAMINATA_SEGURIDAD,
}
