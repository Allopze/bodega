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

export const CHECKLIST_DEFINITIONS: Record<string, ChecklistDefinition> = {
  'trabajador_nuevo': TRABAJADOR_NUEVO,
  'trabajador_antiguo': TRABAJADOR_ANTIGUO,
  'inspeccion_taller': INSPECCION_TALLER,
  'observacion_planeada': OBSERVACION_PLANEADA,
  'inspeccion_extintores': INSPECCION_EXTINTORES,
  'inspeccion_contenedores': INSPECCION_CONTENEDORES,
  'inspeccion_carros': INSPECCION_CARROS,
  'inspeccion_equipos_moviles': INSPECCION_EQUIPOS_MOVILES,
  'inspeccion_epp': INSPECCION_EPP,
  'observacion_ampliroll': OBSERVACION_AMPLIROLL,
  'observacion_maquinaria': OBSERVACION_MAQUINARIA,
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
}
