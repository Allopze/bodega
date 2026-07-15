import type { ChecklistSection } from '../types'

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
 * El markdown 11 es una matriz trabajador × EPP con dos dimensiones (Usa +
 * Estado) por tipo. Decisión lazy-correcta (PLAN_INTEGRACION §5.5): **un ítem
 * por EPP**, `cumple_nocumple_na_obs`, donde `no_cumple` = "no lo usa **o**
 * está en mal estado" y el motivo va en `observacion`. Evita una segunda
 * dimensión y mantiene el % limpio.
 *
 * Excepción: **Bloqueador solar** = `entregado_obs` (se verifica registro de
 * entrega, no estado — igual que la sección EPP de trabajador-nuevo-sections).
 *
 * Normalización (regla §5): Usa Si/No/N/A + Estado B/R/M → cumple/no_cumple/na.
 */
export const EPP_SECTIONS: ChecklistSection[] = [
  {
    id: 'uso_estado_epp',
    title: 'Uso y estado de EPP por trabajador',
    description:
      'Para cada EPP: Cumple = lo usa y está en buen estado · No cumple = no lo usa o está en mal estado (detallar en observación y acción correctiva) · N/A = no aplica al cargo. Bloqueador solar verifica registro de entrega.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'zapatos_seguridad',       label: 'Zapatos de seguridad — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'lentes_seguridad',        label: 'Lentes de seguridad — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'casco_cubre_cuello',      label: 'Casco / cubre cuello — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'guantes',                 label: 'Guantes — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'proteccion_auditiva',     label: 'Protección auditiva — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'ropa_trabajo',            label: 'Ropa de trabajo — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'chaleco_reflectante',     label: 'Chaleco reflectante — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'bloqueador_solar',        label: 'Bloqueador solar — registro de entrega.', kind: 'entregado_obs' },
      { id: 'traje_agua',              label: 'Traje de agua — uso y estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'traje_termico',           label: 'Traje térmico — uso y estado.', kind: 'cumple_nocumple_na_obs' },
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
