import type { ChecklistDefinition } from '../types'
import { EXTINTORES_SECTIONS } from './inspeccion-extintores-sections'

/**
 * Inspección Estado de Extintores — módulo 10.
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=24 del programa 2026. Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = extintor por `subjectLabel` libre en v1 (no hay inventario de
 * extintores; PLAN_INTEGRACION §7). El selector real (o inventario
 * permanente) es follow-up si se pide la alerta de recarga vencida.
 *
 * Firmas (markdown 10): inspector (realizado_por) + revisor.
 */
export const INSPECCION_EXTINTORES: ChecklistDefinition = {
  code: 'inspeccion_extintores',
  version: '01',
  revisionDate: '2026-07-14',
  tipo: 'seguimiento',
  title: 'Inspección de Estado de Extintores',
  subtitle: 'Verificación por extintor — uno por instancia de checklist.',
  legalFramework: [
    'DS 36 (RSE)',
    'Ley 21.512 (ex DS 594)',
    'NCh 1430',
    'NFPA 10',
  ],
  applicableTo:
    'Prevencionista y supervisor. Aplicable a cada extintor existente en faena y talleres.',
  objective:
    'Verificar el estado operativo y la documentación de cada extintor, levantando acciones por unidad defectuosa.',
  frequencySuggested: 'Mensual, por cada extintor.',
  evaluationCriteria:
    'Cada ítem de estado se evalúa como Cumple / No cumple / N/A. "Sin certificado CECMEC" se marca N/A con observación. Los ítems No cumple generan automáticamente acciones del plan de acción PDTP.',
  sections: EXTINTORES_SECTIONS,
  closingAct: {
    title: 'Cierre de inspección del extintor',
    resultOptions: [
      { value: 'operativo', label: 'Operativo' },
      { value: 'con_observaciones', label: 'Con observaciones' },
      { value: 'no_operativo', label: 'No operativo / requiere recarga' },
    ],
    hasRestrictions: false,
    signatureRoles: ['prevencionista', 'supervisor'],
  },
}
