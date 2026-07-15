import type { ChecklistDefinition } from '../types'
import { OBSERVACION_MAQUINARIA_SECTIONS } from './observacion-seguridad-sections'

/**
 * Observación de Seguridad — Maquinaria Pesada — módulo 13 (PR-SGC-25).
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=41 del programa 2026 ("Caminatas de seguridad, levantamiento de
 * inspecciones y observaciones en terreno"). Reemplaza la plantilla genérica
 * provisional de Fase A en esa actividad. Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = `workers` (el operador de maquinaria), filtrado por worksiteId.
 *
 * Comparte estructura con `observacion-ampliroll.ts`; las diferencias
 * terminológicas ("equipo rodante" vs "camión") viven en
 * `observacion-seguridad-sections.ts`.
 *
 * Firmas (markdown 13): observador + operador + prevencionista (+ huella).
 */
export const OBSERVACION_MAQUINARIA: ChecklistDefinition = {
  code: 'observacion_maquinaria',
  version: '01',
  revisionDate: '2026-07-14',
  tipo: 'seguimiento',
  title: 'Observación de Seguridad — Maquinaria Pesada',
  subtitle: 'Observación conductual por operador (PR-SGC-25). Una instancia por operador.',
  legalFramework: [
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
    'Procedimiento PR-SGC-25',
  ],
  applicableTo:
    'Prevencionista y supervisor. Aplicable a cada operador de maquinaria pesada de la faena.',
  objective:
    'Observar las conductas y prácticas seguras del operador de maquinaria durante ingreso/turno, desplazamiento y operación, detectando desviaciones para refuerzo o reinstrucción.',
  frequencySuggested: 'Mensual o por incidente, por operador.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple (Sí) / No cumple (No) / N/A. El % = buenas/22. Cualquier No cumple sugiere reinstrucción del operador. Los ítems No cumple generan automáticamente acciones del plan de acción PDTP.',
  sections: OBSERVACION_MAQUINARIA_SECTIONS,
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
