import type { ChecklistDefinition } from '../types'
import { REPORTE_EQUIPOS_SECTIONS } from './reporte-equipos-sections'

/**
 * Reporte de Equipos — reporte diario de uso, por equipo y por turno.
 *
 * Actividades PDTP 2026 n=25 y n=28. La n=26 ("revisión y firma del report")
 * queda fuera del cableado automático a propósito: el conector
 * `onInspectionCompleted` acredita al **completar**, no al revisar, y dar por
 * acreditada la firma del supervisor en el momento de la digitación
 * falsificaría la evidencia. Se acredita a mano hasta que el conector sepa
 * disparar también en `reviewed`.
 *
 * Estuvo bloqueada durante todo 2026 por dos motivos que ya no aplican: los
 * conductores no tienen cuenta (se resolvió digitando el papel) y el grano
 * diario chocaba con el mensual de `pdtpExecutions` (se resolvió al mudarse al
 * motor de inspecciones, que programa con `frequency: 'daily'`).
 */
export const REPORTE_EQUIPOS: ChecklistDefinition = {
  code: 'reporte_equipos',
  version: '01',
  revisionDate: '2026-08-19',
  tipo: 'seguimiento',
  title: 'Reporte de Equipos',
  subtitle: 'Reporte diario de uso: una instancia por equipo y por turno.',
  legalFramework: [
    'Ley 18.290 (Tránsito)',
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 44',
  ],
  applicableTo:
    'Operador del equipo, digitado por el supervisor de turno o el mecánico. Aplicable a cada camión y maquinaria de la faena, en cada turno.',
  objective:
    'Registrar el uso del equipo en el turno (horómetro, servicios de mantención, combustible) y verificar su estado antes de operar, derivando toda falla a acción correctiva y a mantención.',
  frequencySuggested: 'Diaria, por cada equipo y turno.',
  evaluationCriteria:
    'Cada ítem se evalúa como Normal / Falla / N/A. Una falla en frenos, dirección o sistema de acople nace como hallazgo crítico: la acción correctiva exige detención inmediata y se propone sacar el equipo de servicio. Las secciones de acoplado y las exclusivas no puntúan el cumplimiento —se dejan sin responder cuando no corresponden al equipo— pero una falla en ellas genera hallazgo igual.',
  sections: REPORTE_EQUIPOS_SECTIONS,
  closingAct: {
    title: 'Cierre del reporte de turno',
    resultOptions: [
      { value: 'operativo', label: 'Equipo operativo' },
      { value: 'operativo_con_observaciones', label: 'Operativo con observaciones' },
      { value: 'fuera_de_servicio', label: 'Equipo fuera de servicio' },
    ],
    hasRestrictions: true,
    // Triple firma del papel. Se registra rol + nombre + momento; el trazo real
    // vive en la foto del reporte firmado, adjunta como evidencia de respuesta.
    signatureRoles: ['operador_entrante', 'operador_saliente', 'supervisor_turno'],
  },
}
