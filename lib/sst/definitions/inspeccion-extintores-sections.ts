import type { ChecklistSection } from '../types'

/**
 * Inspección Estado de Extintores — módulo 10.
 *
 * Fuente: `docx revisado/10-inspeccion-extintores.md`.
 * Actividad PDTP 2026: n=24 ("Inspección estado de extintores").
 *
 * Patrón C (multi-sujeto): una instancia por extintor. En Fase B/C el sujeto
 * es label libre (subjectType='extintor', subjectId=código). La alerta de
 * "recarga vencida" es follow-up (no v1) — PLAN_INTEGRACION §5.3.
 *
 * El markdown 10 mezcla dos tipos de campos por extintor:
 *   - **Estado** (B/M → cumple/no_cumple): certifican el extintor en uso.
 *     `countsForCompliance:true`, `hasActionCorrectiva:true`.
 *   - **Inventario** (tipo, peso, recarga…): descriptivos, `countsForCompliance:false`.
 *     Se capturan para trazabilidad/export; no generan acciones ni afectan el %.
 *
 * Normalización B/M (regla §5): B=cumple, M=no_cumple. El estado CECMEC del
 * markdown tiene 3 valores (bueno/malo/sin_certificado); se modela como
 * `cumple_nocumple_na_obs` donde `na`=sin certificado (no bloquea el % pero
 * deja evidencia en la observación).
 */
export const EXTINTORES_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 1. Inventario del extintor (descriptivo — no cuenta para el %)
  // ============================================================
  {
    id: 'inventario_extintor',
    title: '1. Inventario del extintor',
    description: 'Identificación y datos de recarga del extintor inspeccionado. No afecta el % de cumplimiento.',
    countsForCompliance: false,
    items: [
      {
        id: 'tipo_extintor',
        label: 'Tipo de extintor',
        kind: 'select',
        options: [
          { value: 'pqs', label: 'PQS (Polvo Químico Seco)' },
          { value: 'co2', label: 'CO₂' },
          { value: 'agua', label: 'Agua' },
          { value: 'espuma', label: 'Espuma' },
          { value: 'otro', label: 'Otro' },
        ],
        placeholder: 'Selecciona el tipo…',
      },
      {
        id: 'peso_kg',
        label: 'Peso (kg)',
        kind: 'text',
        placeholder: 'p.ej. 4, 6, 9, 12…',
      },
      {
        id: 'empresa_recarga',
        label: 'Empresa de recarga',
        kind: 'text',
        placeholder: 'Razón social del prestador de recarga…',
      },
      {
        id: 'fecha_recarga',
        label: 'Fecha de última recarga',
        kind: 'date',
      },
    ],
  },

  // ============================================================
  // 2. Estado del extintor (B/M → cumple/no_cumple)
  // ============================================================
  {
    id: 'estado_extintor',
    title: '2. Estado del extintor',
    description: 'Evaluación de condiciones operativas. Marca No cumple ante cualquier desviación y registra la acción correctiva.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'manometro',       label: 'Manómetro — aguja en zona verde.', kind: 'cumple_nocumple_na_obs' },
      { id: 'sello',           label: 'Sello de seguridad intacto (no manipulado).', kind: 'cumple_nocumple_na_obs' },
      { id: 'rotulado',        label: 'Rótulo/etiqueta legible y en buen estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'manguera',        label: 'Manguera sin cortes ni obstrucciones.', kind: 'cumple_nocumple_na_obs' },
      { id: 'cecmec',          label: 'Certificado CECMEC vigente (Centro de Certificación de Metrología y Control). Marca N/A si no aplica.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 3. Observaciones generales
  // ============================================================
  {
    id: 'observaciones_extintor',
    title: '3. Observaciones generales',
    description: 'Registro libre de hallazgos adicionales del extintor inspeccionado.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales',
        kind: 'text',
        placeholder: 'Describe observaciones, estado de ubicación, accesibilidad…',
      },
    ],
  },
]
