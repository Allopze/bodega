import type { ChecklistDefinition } from '../types'
import { EPP_SECTIONS } from './inspeccion-epp-sections'
import { NORMALIZED_ONLY_SCORING } from '../scoring-policies'

/**
 * Inspección de Uso y Estado de EPP — módulo 11.
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de las actividades PDTP
 * n=64 y n=65 del programa 2026 (ambas "Check list de uso y estado de EPP",
 * responsables JT y PRF). Ver `scripts/seed-pdtp-inspection-templates-2026.ts`.
 *
 * Sujeto = `workers`, filtrado por worksiteId de la ejecución.
 *
 * Firmas (markdown 11): inspector + revisor.
 */
export const INSPECCION_EPP: ChecklistDefinition = {
  code: 'inspeccion_epp',
  version: '03',
  revisionDate: '2026-08-30',
  tipo: 'seguimiento',
  title: 'Inspección de Uso y Estado de EPP',
  subtitle: 'Verificación por trabajador: uno por instancia de checklist.',
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
    'Cada EPP conserva dos respuestas independientes: Usa (Sí/No/N/A) y Estado (Bueno/Regular/Malo). Bloqueador solar conserva Uso y Registro por separado. La métrica normalizada no reemplaza esas respuestas documentales.',
  sections: EPP_SECTIONS,
  scoringPolicy: NORMALIZED_ONLY_SCORING,
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
