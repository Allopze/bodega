import type { ChecklistDefinition } from '../types'
import { EPP_SECTIONS } from './inspeccion-epp-sections'

/**
 * Inspección de Uso y Estado de EPP — módulo 11.
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de las actividades PDTP
 * n=64 y n=65 del programa 2026 (ambas "Check list de uso y estado de EPP",
 * responsables JT y PRF). Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = `workers`, filtrado por worksiteId de la ejecución.
 *
 * Firmas (markdown 11): inspector + revisor.
 */
export const INSPECCION_EPP: ChecklistDefinition = {
  code: 'inspeccion_epp',
  version: '01',
  revisionDate: '2026-07-14',
  tipo: 'seguimiento',
  title: 'Inspección de Uso y Estado de EPP',
  subtitle: 'Verificación por trabajador — uno por instancia de checklist.',
  legalFramework: [
    'Ley 21.512 (ex DS 594)',
    'DS 40',
    'Ley 16.744',
  ],
  applicableTo:
    'Prevencionista y supervisor/JT. Aplicable a cada trabajador de la faena y taller.',
  objective:
    'Verificar el uso y estado del EPP de cada trabajador, detectando EPP en mal estado o mal uso para su recambio o reinstrucción.',
  frequencySuggested: 'Mensual, por trabajador.',
  evaluationCriteria:
    'Cada EPP se evalúa como Cumple (lo usa y está en buen estado) / No cumple (no lo usa o está en mal estado) / N/A. Bloqueador solar verifica registro de entrega. Los ítems No cumple generan automáticamente acciones del plan de acción PDTP.',
  sections: EPP_SECTIONS,
  closingAct: {
    title: 'Cierre de inspección de EPP',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'con_observaciones', label: 'Con observaciones' },
      { value: 'no_conforme', label: 'No conforme' },
    ],
    hasRestrictions: false,
    signatureRoles: ['supervisor', 'prevencionista'],
  },
}
