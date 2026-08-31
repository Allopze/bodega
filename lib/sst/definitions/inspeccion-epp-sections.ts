import type { ChecklistItem, ChecklistSection } from '../types'

function eppMatrixRow(
  id: string,
  label: string,
  danoPotencial: NonNullable<ChecklistItem['danoPotencial']>,
): ChecklistItem[] {
  return [
    {
      id: `${id}_uso`, label: `${label}: usa`, kind: 'si_no_na_obs', danoPotencial,
      matrix: { rowId: id, rowLabel: label, columnLabel: 'Usa (Sí/No/N/A)' },
    },
    {
      id: `${id}_estado`, label: `${label}: estado`, kind: 'bueno_regular_malo_obs', danoPotencial,
      matrix: { rowId: id, rowLabel: label, columnLabel: 'Estado (B/R/M)' },
    },
  ]
}

/**
 * Inspección de Uso y Estado de EPP — módulo 11.
 *
 * Fuente: `docx revisado/11-inspeccion-epp.md`.
 * Actividades PDTP 2026: n=64 y n=65 ("Check list de uso y estado de EPP",
 * responsables JT y PRF respectivamente).
 *
 * Patrón C (multi-sujeto): una instancia por trabajador. Sujeto = `workers`,
 * filtrado por worksiteId de la ejecución. La cobertura ("% trabajadores con
 * EPP completo") se deriva de instancias completadas / trabajadores de la faena.
 *
 * El Anexo 3 es una matriz trabajador × EPP con dos dimensiones por tipo:
 * **Usa** (SI / NO / N/A) y **Estado** (B = BUENO / R = REGULAR / M = MALO).
 * Cada dimensión se persiste por separado. `matrix` sólo decide la presentación
 * visual: no vuelve a fusionar Uso y Estado en una respuesta ambigua.
 */
export const EPP_SECTIONS: ChecklistSection[] = [
  {
    id: 'uso_estado_epp',
    title: 'Uso y estado de EPP por trabajador',
    description:
      'Para cada EPP responda por separado Uso (Sí/No/N/A) y Estado (Bueno/Regular/Malo). Bloqueador solar conserva Uso y Registro como columnas independientes.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      ...eppMatrixRow('zapatos_seguridad', 'Zapatos de seguridad', 'grave'),
      ...eppMatrixRow('lentes_seguridad', 'Lentes de seguridad', 'grave'),
      ...eppMatrixRow('casco_cubre_cuello', 'Casco / cubre cuello', 'fatal'),
      ...eppMatrixRow('guantes', 'Guantes', 'grave'),
      ...eppMatrixRow('proteccion_auditiva', 'Protección auditiva', 'grave'),
      ...eppMatrixRow('ropa_trabajo', 'Ropa de trabajo', 'grave'),
      ...eppMatrixRow('chaleco_reflectante', 'Chaleco reflectante', 'fatal'),
      {
        id: 'bloqueador_solar_uso', label: 'Bloqueador solar: usa', kind: 'si_no_na_obs',
        matrix: { rowId: 'bloqueador_solar', rowLabel: 'Bloqueador solar', columnLabel: 'Usa (Sí/No/N/A)' },
      },
      {
        id: 'bloqueador_solar_registro', label: 'Bloqueador solar: registro', kind: 'si_no_obs',
        matrix: { rowId: 'bloqueador_solar', rowLabel: 'Bloqueador solar', columnLabel: 'Registro (Sí/No)' },
      },
      ...eppMatrixRow('traje_agua', 'Traje de agua', 'moderado'),
      ...eppMatrixRow('traje_termico', 'Traje térmico', 'grave'),
    ],
  },
  {
    id: 'observaciones_epp',
    title: 'Observaciones generales',
    description: 'Registro libre de hallazgos adicionales sobre el EPP del trabajador.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales',
        kind: 'text',
        placeholder: 'Describe observaciones, recambio de EPP en mal estado…',
      },
    ],
  },
]
