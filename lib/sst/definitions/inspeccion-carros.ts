import type { ChecklistDefinition } from '../types'
import { CARROS_SECTIONS } from './inspeccion-carros-sections'

/**
 * Inspección de Carros — módulo 07.
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=34 del programa 2026. Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = `fuelVehicles` (el carro), filtrado por worksiteId de la ejecución.
 * El carro se vincula a su camión vía `subjectLabel` (patente del carro).
 *
 * Firmas (markdown 07): supervisor de faena + chofer entrevistado + prevencionista.
 */
export const INSPECCION_CARROS: ChecklistDefinition = {
  code: 'inspeccion_carros',
  version: '02',
  revisionDate: '2026-08-04',
  tipo: 'seguimiento',
  title: 'Inspección de Carros',
  subtitle: 'Verificación por carro: uno por instancia de checklist.',
  legalFramework: [
    'Ley 18.290 (Tránsito)',
    'Ley 16.744',
    'DS 40',
  ],
  applicableTo:
    'Supervisor/Jefe de Terrain y prevencionista, junto al chofer. Aplicable a cada carro de la faena.',
  objective:
    'Verificar el estado de luces, neumáticos, documentación y estructura de cada carro, levantando hallazgos y acciones correctivas.',
  frequencySuggested: 'Mensual, por cada carro.',
  evaluationCriteria:
    'Escala del anexo: Bueno / Regular / Malo. Bueno suma 1 punto, Regular 0.5 y Malo 0. Regular y Malo exigen observación. Los ítems en Malo generan automáticamente acciones del plan de acción PDTP.',
  sections: CARROS_SECTIONS,
  closingAct: {
    title: 'Cierre de inspección del carro',
    resultOptions: [
      { value: 'aprobado', label: 'Aprobado' },
      { value: 'con_observaciones', label: 'Aprobado con observaciones' },
      { value: 'rechazado', label: 'Rechazado' },
    ],
    hasRestrictions: false,
    signatureRoles: ['supervisor', 'trabajador', 'prevencionista'],
  },
}
