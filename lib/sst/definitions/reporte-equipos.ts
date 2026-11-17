import type { ChecklistDefinition } from '../types'
import { REPORTE_EQUIPOS_SECTIONS } from './reporte-equipos-sections'

/**
 * Reporte de Equipos — reporte diario de uso, por equipo y por turno.
 *
 * Actividades PDTP 2026 n=25 (digitación/cierre) y n=26 (revisión segregada).
 * La n=28 es un cierre semanal sobre el conjunto de reportes y hallazgos, por
 * eso no se acredita por cada run individual.
 *
 * Estuvo bloqueada durante todo 2026 por dos motivos que ya no aplican: los
 * conductores no tienen cuenta (se resolvió porque el jefe de faena traspasa el papel) y el grano
 * diario chocaba con el mensual de `pdtpExecutions` (se resolvió al mudarse al
 * motor de inspecciones, que programa con `frequency: 'daily'`).
 *
 * ── Historia ─────────────────────────────────────────────────────────────
 * v03 (2026-11-17), tras revisar 30 reportes en papel reales:
 *   1. `scheduleSkipsSundays`: la programación es de lunes a sábado.
 *   2. `appliesToVehicleTypes` en las secciones condicionales (carga, ampliroll,
 *      acoplado): no se muestran ni cuentan si el tipo del equipo no las lleva.
 *   3. `notLessThanItemId` en el horómetro de término: no puede ser menor que
 *      el de inicio.
 *   4. `closingAct.allowMissingSignatures`: el papel puede traer firmas en
 *      blanco y el transcriptor no inventa un nombre.
 *   5. Turno, área de trabajo y horómetro de término dejan de ser obligatorios,
 *      porque el papel los trae en blanco; horómetro de inicio y operador
 *      entrante siguen siéndolo.
 * v02 (2026-08-30): cierra al declararse ejecutado (`closesOnCompletion`).
 */
export const REPORTE_EQUIPOS: ChecklistDefinition = {
  code: 'reporte_equipos',
  version: '03',
  revisionDate: '2026-11-17',
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
    'Registro físico del operador y del mecánico, traspasado a la plataforma exclusivamente por el jefe de faena. Aplicable a cada camión y maquinaria de la faena, en cada turno.',
  objective:
    'Registrar el uso del equipo en el turno (horómetro, servicios de mantención, combustible) y verificar su estado antes de operar, derivando toda falla a acción correctiva y a mantención.',
  frequencySuggested: 'Diaria, por cada equipo y turno.',
  evaluationCriteria:
    'Cada ítem se evalúa como Normal / Falla / N/A. Una falla en frenos, dirección o sistema de acople nace como hallazgo crítico: la acción correctiva exige detención inmediata y se propone sacar el equipo de servicio. Las secciones de acoplado y las exclusivas no puntúan el cumplimiento —se dejan sin responder cuando no corresponden al equipo— pero una falla en ellas genera hallazgo igual.',
  /* Cierra al declararse ejecutado: el operador llena el papel y el supervisor
   * lo transcribe, y transcribirlo línea por línea ES revisarlo y firmarlo —
   * de ahí que este instrumento acredite la n=25 y la n=26 en el mismo acto.
   * Sin esto, un reporte por equipo y por turno inundaba "Esperando
   * revisión". Los que levanten un hallazgo grave sí esperan revisión. */
  closesOnCompletion: true,
  scheduleSkipsSundays: true,
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
    // El papel puede traer una firma en blanco; se transcribe tal cual y la
    // plataforma lo dice («Sin firma en el papel») en vez de exigir un nombre.
    allowMissingSignatures: true,
  },
}
