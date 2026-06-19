import { TRABAJADOR_NUEVO } from './trabajador-nuevo'
import { TRABAJADOR_ANTIGUO } from './trabajador-antiguo'
import type { ChecklistDefinition } from '../types'

export const CHECKLIST_DEFINITIONS: Record<string, ChecklistDefinition> = {
  'trabajador_nuevo': TRABAJADOR_NUEVO,
  'trabajador_antiguo': TRABAJADOR_ANTIGUO,
}

export function getDefinition(code: string, _version?: string): ChecklistDefinition {
  const def = CHECKLIST_DEFINITIONS[code]
  if (!def) throw new Error(`Unknown checklist definition: ${code}`)
  return def
}

export { TRABAJADOR_NUEVO, TRABAJADOR_ANTIGUO }
