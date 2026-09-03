import type { ChecklistDefinition } from '../types'
import { CONDICIONES_AMBIENTALES_SECTIONS } from './inspeccion-condiciones-ambientales-sections'
import { NORMALIZED_ONLY_SCORING } from '../scoring-policies'

/**
 * Verificación de condiciones ambientales básicas — DS N°594.
 *
 * Patrón B (single-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=10 del programa 2026 (D11, decisión del 2026-09-02: "sí, escribirlo").
 * Hasta esta definición la N°10 era `constancia` porque no existía checklist
 * que la respaldara; con esto pasa a `enganche` vía `PDTP_2026_INSPECTION_SPECS`.
 *
 * Firma: prevencionista de faena, responsable declarado de la N°10 en el
 * catálogo. Sin acompañante fijo (a diferencia de la del taller, que exige un
 * encargado de área): la faena decide si el jefe de terreno participa.
 */
export const INSPECCION_CONDICIONES_AMBIENTALES: ChecklistDefinition = {
  code: 'inspeccion_condiciones_ambientales',
  version: '01',
  revisionDate: '2026-09-02',
  tipo: 'seguimiento',
  title: 'Verificación de Condiciones Ambientales Básicas (DS N°594)',
  subtitle: 'Lista de chequeo mensual de condiciones sanitarias y ambientales básicas de la faena.',
  legalFramework: [
    'Ley 21.512 (ex DS 594)',
  ],
  applicableTo:
    'Prevencionista de riesgos en faena. Aplicable a toda faena con instalaciones fijas de trabajo.',
  objective:
    'Verificar el cumplimiento de las condiciones sanitarias y ambientales básicas de los lugares de trabajo —agua potable, servicios higiénicos, vestidores, comedor, disposición de residuos, ventilación e iluminación— levantando hallazgos y acciones correctivas.',
  frequencySuggested: 'Mensual.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple / Cumple parcialmente / No cumple / N/A. Cumple parcialmente se conserva como estado propio y puntúa 0,5 sólo en la métrica normalizada.',
  sections: CONDICIONES_AMBIENTALES_SECTIONS,
  scoringPolicy: NORMALIZED_ONLY_SCORING,
  closingAct: {
    title: 'Cierre de verificación',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'conforme_parcial', label: 'Conforme parcial' },
      { value: 'no_conforme', label: 'No conforme' },
    ],
    hasRestrictions: false,
    signatureRoles: ['prevencionista'],
  },
}
