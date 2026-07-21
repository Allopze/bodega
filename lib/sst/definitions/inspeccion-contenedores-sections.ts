import type { ChecklistSection } from '../types'

/**
 * Inspección de Contenedores — módulo 08.
 *
 * Fuente: `docx revisado/08-inspeccion-contenedores.md`.
 * Actividad PDTP 2026: n=29 ("Lista de chequeo contenedores").
 *
 * Patrón C (multi-sujeto): una instancia por contenedor. Sujeto = contenedor
 * por `subjectLabel` libre en v1 (no hay inventario permanente; PLAN_INTEGRACION
 * §7). El inventario + alerta de estado operativo es follow-up (no v1).
 *
 * Normalización B/R/M/NA/NT (regla §5): B=cumple · R=no_cumple (prioridad
 * media) · M=no_cumple (prioridad alta) · NA=na · NT=na+obs "no tiene".
 * Modelado como `cumple_nocumple_na_obs` — el detalle R vs M va en la
 * observación y la acción correctiva.
 *
 * Ítems críticos (markdown 08): Soportes de levante + Cadenas de fijación en
 * estado Malo → contenedor fuera de servicio (acción alta). El inspector lo
 * refleja en la observación y la prioridad se ajusta al cierre.
 */
export const CONTENEDORES_SECTIONS: ChecklistSection[] = [
  {
    id: 'estructura_contenedor',
    title: 'Evaluación estructural y de componentes del contenedor',
    description:
      'Marca Cumple (Bueno) / No cumple (Regular o Malo) / N/A (No aplica o No tiene). Si marca No cumple, describe el estado (Regular/Malo) y la acción correctiva. Los ítems críticos (soportes de levante, cadenas de fijación) en Malo requieren acción de prioridad alta.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'soportes_levante',       label: 'Soportes de levante.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'cadenas_fijacion',       label: 'Cadenas de fijación.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'puerta_lateral_volteo',  label: 'Puerta lateral o de volteo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'puerta_escotilla',       label: 'Puerta escotilla.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'seguro_puertas',         label: 'Seguro de puertas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'sellos_hermerticos',     label: 'Sellos de puertas herméticos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'bisagras_puertas',       label: 'Bisagras de puertas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'letreros',               label: 'Letreros.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'aletas_seguridad',       label: 'Aletas de seguridad.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'rodillos',               label: 'Rodillos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'escalas_accesos',        label: 'Escalas de accesos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'estructura_barrotes',    label: 'Estructura apoya barrotes.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'estado_vigas',           label: 'Estado de vigas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'estado_general',         label: 'Estado general del contenedor.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },
  {
    id: 'observaciones_contenedor',
    title: 'Observaciones generales',
    description: 'Registro libre de hallazgos adicionales del contenedor inspeccionado.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales',
        kind: 'text',
        placeholder: 'Describe observaciones o medidas de control del contenedor…',
      },
    ],
  },
]
