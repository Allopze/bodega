import type { ChecklistDefinition } from '../types'
import { NORMALIZED_ONLY_SCORING } from '../scoring-policies'

/**
 * Anexo 08 — Inspección no planeada.
 *
 * Instrumento documental independiente y bajo demanda. No acredita una
 * actividad PDTP: registra participantes y hallazgos narrativos, que son la
 * única fuente de verdad para sus acciones CAPA.
 */
export const INSPECCION_NO_PLANEADA: ChecklistDefinition = {
  code: 'inspeccion_no_planeada',
  version: '01',
  revisionDate: '2026-08-30',
  tipo: 'seguimiento',
  title: 'Inspección no planeada',
  subtitle: 'Anexo 08. Inspección bajo demanda con hallazgos y evidencias por desviación.',
  legalFramework: ['Ley 16.744', 'DS 44', 'Ley 21.512 (ex DS 594)'],
  applicableTo: 'Áreas, instalaciones, tareas o equipos que requieran una inspección no programada.',
  objective: 'Registrar la condición observada, su daño potencial, medidas preventivas y normativa aplicable.',
  frequencySuggested: 'Bajo demanda.',
  evaluationCriteria: 'No se puntúa. Cada desviación se registra como un hallazgo narrativo independiente.',
  recordsDeviations: true,
  scoringPolicy: NORMALIZED_ONLY_SCORING,
  sections: [
    {
      id: 'contexto',
      title: 'Antecedentes de la inspección',
      countsForCompliance: false,
      items: [
        { id: 'lugar_area', label: 'Lugar o área inspeccionada', kind: 'text', required: true },
        { id: 'descripcion_general', label: 'Descripción general de la inspección', kind: 'textarea', required: true },
      ],
    },
  ],
}
