import type { ChecklistDefinition } from '../types'
import { EQUIPOS_MOVILES_SECTIONS } from './inspeccion-equipos-moviles-sections'

/**
 * Inspección de Equipos Móviles — módulo 05.
 *
 * Patrón C (multi-sujeto). Se siembra como plantilla de la actividad PDTP
 * n=33 del programa 2026. Ver `scripts/seed-pdtp-checklists-2026.ts`.
 *
 * Sujeto = `fuelVehicles` (camión o equipo), filtrado por worksiteId de la
 * ejecución. La documentación (SOAP, rev. técnica, permiso, seguro) se lee de
 * las columnas `*ExpiresAt` del vehículo en el selector.
 *
 * Firmas (markdown 05): operador + inspector + revisor (triple firma).
 */
export const INSPECCION_EQUIPOS_MOVILES: ChecklistDefinition = {
  code: 'inspeccion_equipos_moviles',
  version: '01',
  revisionDate: '2026-07-14',
  tipo: 'seguimiento',
  title: 'Inspección de Equipos Móviles',
  subtitle: 'Verificación por equipo: uno por instancia de checklist. Realizar en conjunto con el operador.',
  legalFramework: [
    'Ley 18.290 (Tránsito)',
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
  ],
  applicableTo:
    'Prevencionista junto al operador del equipo. Aplicable a cada equipo móvil (camión, maquinaria) de la faena.',
  objective:
    'Verificar el estado documental, de cabina, accesorios de emergencia, luces, ruedas y estado mecánico de cada equipo móvil, levantando hallazgos y acciones correctivas.',
  frequencySuggested: 'Mensual, por cada equipo.',
  evaluationCriteria:
    'Cada ítem se evalúa como Cumple / No cumple / N/A. Frenos o dirección en No cumple sugieren fuera de servicio (acción de prioridad alta). Los ítems No cumple generan automáticamente acciones del plan de acción PDTP.',
  sections: EQUIPOS_MOVILES_SECTIONS,
  closingAct: {
    title: 'Cierre de inspección del equipo',
    resultOptions: [
      { value: 'aprobado', label: 'Aprobado' },
      { value: 'aprobado_con_observaciones', label: 'Aprobado con observaciones' },
      { value: 'rechazado', label: 'Rechazado' },
    ],
    hasRestrictions: false,
    signatureRoles: ['trabajador', 'supervisor', 'prevencionista'],
  },
}
