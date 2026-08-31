import type { ChecklistDefinition } from '../types'
import { TALLER_SECTIONS } from './inspeccion-taller-sections'
import { NORMALIZED_ONLY_SCORING } from '../scoring-policies'

/**
 * Inspección Taller de Mantención y Bodega de Acopio RESPEL — módulo 06.
 *
 * Patrón B (single-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=27 del programa 2026. Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Firmas (markdown 06): ejecutor (prevencionista) + acompañante
 * (encargado de taller / supervisor de faena). El acta de cierre modela
 * `conforme / conforme_parcial / no_conforme` tal como el formulario fuente.
 */
export const INSPECCION_TALLER: ChecklistDefinition = {
  code: 'inspeccion_taller',
  version: '02',
  revisionDate: '2026-08-30',
  tipo: 'seguimiento',
  title: 'Inspección de Taller de Mantención y Bodega de Acopio RESPEL',
  subtitle: 'Lista de chequeo mensual de condiciones de seguridad del taller y bodega de acopio.',
  legalFramework: [
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
    'DS 911 (RESPEL)',
  ],
  applicableTo:
    'Prevencionista de faena en conjunto con el encargado de taller. Aplicable a faenas con taller de mantención y bodega de acopio.',
  objective:
    'Verificar las condiciones de seguridad estructural, operacional y de almacenamiento del taller de mantención y la bodega de acopio RESPEL, levantando hallazgos y acciones correctivas.',
  frequencySuggested: 'Mensual.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple / Cumple parcialmente / No cumple / N/A. Cumple parcialmente se conserva como estado propio y puntúa 0,5 sólo en la métrica normalizada.',
  sections: TALLER_SECTIONS,
  scoringPolicy: NORMALIZED_ONLY_SCORING,
  closingAct: {
    title: 'Cierre de inspección',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'conforme_parcial', label: 'Conforme parcial' },
      { value: 'no_conforme', label: 'No conforme' },
    ],
    hasRestrictions: false,
    signatureRoles: ['prevencionista', 'jefe_area'],
  },
}
