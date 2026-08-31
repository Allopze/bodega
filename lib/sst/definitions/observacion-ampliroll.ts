import type { ChecklistDefinition } from '../types'
import { OBSERVACION_AMPLIROLL_SECTIONS } from './observacion-seguridad-sections'
import { OBSERVATION_22_SCORING } from '../scoring-policies'

/**
 * Observación de Seguridad: Camión Ampliroll — módulo 12 (PR-SGC-24).
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=40 del programa 2026 ("Realizar Inspecciones para corregir desviaciones").
 * Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = `workers` (el operador), filtrado por worksiteId de la ejecución.
 * `% = buenas/22`. "Se reinstruye" se deriva de cualquier `no_cumple`.
 *
 * Comparte estructura con `observacion-maquinaria.ts` (95% idéntica) — los
 * matices terminológicos viven en `observacion-seguridad-sections.ts`.
 *
 * Firmas (markdown 12): observador + operador + prevencionista (+ huella).
 */
export const OBSERVACION_AMPLIROLL: ChecklistDefinition = {
  code: 'observacion_ampliroll',
  version: '02',
  revisionDate: '2026-08-30',
  tipo: 'seguimiento',
  title: 'Observación de Seguridad: Camión Ampliroll',
  subtitle: 'Observación conductual por operador (PR-SGC-24). Una instancia por operador.',
  legalFramework: [
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
    'Procedimiento PR-SGC-24',
  ],
  applicableTo:
    'Prevencionista y supervisor. Aplicable a cada operador de camión ampliroll de la faena.',
  objective:
    'Observar las conductas y prácticas seguras del operador durante ingreso/turno, desplazamiento y operación, detectando desviaciones para refuerzo o reinstrucción.',
  frequencySuggested: 'Mensual o por incidente, por operador.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple (Sí) / No cumple (No) / N/A. El % = buenas/22. Cualquier No cumple sugiere reinstrucción del operador. Los ítems No cumple generan automáticamente acciones del plan de acción PDTP.',
  sections: OBSERVACION_AMPLIROLL_SECTIONS,
  scoringPolicy: OBSERVATION_22_SCORING,
  closingAct: {
    title: 'Cierre de observación',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'requiere_reforzamiento', label: 'Requiere reforzamiento / reinstrucción' },
      { value: 'no_conforme', label: 'No conforme' },
    ],
    hasRestrictions: false,
    signatureRoles: ['prevencionista', 'trabajador', 'supervisor'],
  },
}
