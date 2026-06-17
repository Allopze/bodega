import { LC_SST_001 } from './lc-sst-001'
import { LC_SST_002 } from './lc-sst-002'
import type { ChecklistDefinition } from '../types'

export const CHECKLIST_DEFINITIONS: Record<string, ChecklistDefinition> = {
  'LC-SST-001': LC_SST_001,
  'LC-SST-002': LC_SST_002,
}

export function getDefinition(code: string, _version?: string): ChecklistDefinition {
  const def = CHECKLIST_DEFINITIONS[code]
  if (!def) throw new Error(`Unknown checklist definition: ${code}`)
  return def
}

export { LC_SST_001, LC_SST_002 }
