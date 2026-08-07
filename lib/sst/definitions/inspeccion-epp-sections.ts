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
 * El Anexo 3 es una matriz trabajador × EPP con dos dimensiones por tipo:
 * **Usa** (SI / NO / N/A) y **Estado** (B = BUENO / R = REGULAR / M = MALO).
 * Decisión vigente (PLAN_INTEGRACION §5.5): **un ítem por EPP** en vez de dos,
 * para no duplicar el trabajo de terreno — son 10 EPP por trabajador y esto es
 * multi-sujeto.
 *
 * Escala `bueno_regular_malo_na_obs`, leída como el Estado del anexo:
 *   Bueno = lo usa y está en buen estado · Regular = lo usa pero deteriorado
 *   (puntúa 0.5) · Malo = no lo usa o está inservible · N/A = no aplica al cargo.
 * El motivo va en `observacion`, obligatoria en Regular y Malo.
 *
 * Excepción: **Bloqueador solar** = `entregado_obs` (el anexo pide "Registro",
 * no "Estado" — igual que la sección EPP de trabajador-nuevo-sections).
 *
 * Pendiente de decisión: separar Usa y Estado en dos campos, como el papel.
 * Duplicaría los ítems de 10 a 20 por trabajador; hoy se mantiene el colapso.
 */
export const EPP_SECTIONS: ChecklistSection[] = [
  {
    id: 'uso_estado_epp',
    title: 'Uso y estado de EPP por trabajador',
    description:
      'Para cada EPP: Bueno = lo usa y está en buen estado · Regular = lo usa pero deteriorado · Malo = no lo usa o está inservible · N/A = no aplica al cargo. Regular y Malo exigen observación. Bloqueador solar verifica registro de entrega.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'zapatos_seguridad',       label: 'Zapatos de seguridad: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'lentes_seguridad',        label: 'Lentes de seguridad: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'casco_cubre_cuello',      label: 'Casco / cubre cuello: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'guantes',                 label: 'Guantes: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'proteccion_auditiva',     label: 'Protección auditiva: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'ropa_trabajo',            label: 'Ropa de trabajo: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'chaleco_reflectante',     label: 'Chaleco reflectante: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'bloqueador_solar',        label: 'Bloqueador solar: registro de entrega.', kind: 'entregado_obs' },
      { id: 'traje_agua',              label: 'Traje de agua: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'traje_termico',           label: 'Traje térmico: uso y estado.', kind: 'bueno_regular_malo_na_obs',
        danoPotencial: 'grave',
      },
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
