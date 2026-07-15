import type { ChecklistDefinition } from '../types'
import { OBSERVACION_PLANEADA_SECTIONS } from './observacion-planeada-sections'

/**
 * Observación Planeada de Seguridad — módulo 14 (genérica, provisional).
 *
 * ⚠️ El markdown fuente (Anexo 7) no está disponible en `docx revisado/`.
 * Esta definición es genérica y provisional; confirmar contenido con el
 * cliente. Ver `observacion-planeada-sections.ts` y PLAN_INTEGRACION §5.6.
 *
 * Se siembra como plantilla de la actividad PDTP n=41 del programa 2026
 * ("Caminatas de seguridad, levantamiento de inspecciones y observaciones
 * en terreno"). Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Firmas: observador (prevencionista) + acompañante (administrador de
 * contrato / jefe de área).
 */
export const OBSERVACION_PLANEADA: ChecklistDefinition = {
  code: 'observacion_planeada',
  version: '01',
  revisionDate: '2026-07-14',
  tipo: 'seguimiento',
  title: 'Observación Planeada de Seguridad (Caminata de Terreno)',
  subtitle:
    'Plantilla genérica provisional — contenido pendiente de confirmación con el cliente (módulo 14, fuente Anexo 7 faltante).',
  legalFramework: [
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
  ],
  applicableTo:
    'Prevencionista y administrador de contrato durante caminatas de seguridad y observaciones planeadas en terreno.',
  objective:
    'Registrar observaciones planeadas de condiciones, comportamientos y equipos durante caminatas de seguridad, levantando hallazgos y acciones correctivas.',
  frequencySuggested: 'Mensual o semanal según programación de la actividad.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple / No cumple / N/A. Los ítems No cumple generan automáticamente acciones del plan de acción PDTP.',
  sections: OBSERVACION_PLANEADA_SECTIONS,
  closingAct: {
    title: 'Cierre de observación',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'con_observaciones', label: 'Con observaciones' },
      { value: 'no_conforme', label: 'No conforme' },
    ],
    hasRestrictions: false,
    signatureRoles: ['prevencionista', 'jefe_area'],
  },
}
