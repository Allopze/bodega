import type { ChecklistDefinition } from '../types'
import { CONTENEDORES_SECTIONS } from './inspeccion-contenedores-sections'

/**
 * Inspección de Contenedores — módulo 08.
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=29 del programa 2026. Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = contenedor por `subjectLabel` libre en v1 (no hay inventario;
 * PLAN_INTEGRACION §7).
 *
 * Firmas (markdown 08): jefe de terreno + prevencionista.
 */
export const INSPECCION_CONTENEDORES: ChecklistDefinition = {
  code: 'inspeccion_contenedores',
  version: '01',
  revisionDate: '2026-07-14',
  tipo: 'seguimiento',
  title: 'Inspección de Contenedores',
  subtitle: 'Verificación por contenedor — uno por instancia de checklist.',
  legalFramework: [
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
  ],
  applicableTo:
    'Supervisor/Jefe de terreno y prevencionista. Aplicable a cada contenedor de la faena.',
  objective:
    'Verificar las condiciones estructurales y de seguridad de cada contenedor, priorizando los ítems críticos (soportes de levante y cadenas de fijación).',
  frequencySuggested: 'Mensual, según cantidad de contenedores de la faena.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple (Bueno) / No cumple (Regular o Malo) / N/A (No aplica o No tiene). El detalle del estado (R vs M) se registra en la observación y define la prioridad de la acción correctiva.',
  sections: CONTENEDORES_SECTIONS,
  closingAct: {
    title: 'Cierre de inspección del contenedor',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'con_observaciones', label: 'Con observaciones' },
      { value: 'no_conforme', label: 'No conforme / fuera de servicio' },
    ],
    hasRestrictions: false,
    signatureRoles: ['jefe_area', 'prevencionista'],
  },
}
