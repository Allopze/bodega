import type { ChecklistSection } from '../types'

/**
 * Inspección de Contenedores — módulo 08.
 *
 * Fuente: `docx revisado/08-inspeccion-contenedores.md`.
 * Actividad PDTP 2026: n=29 ("Lista de chequeo contenedores").
 *
 * Patrón C (multi-sujeto): una instancia por contenedor. Sujeto = contenedor del
 * catálogo (`prevention_containers`), obligatorio: el texto libre existía sólo
 * mientras no había padrón permanente.
 *
 * Escala nativa B/R/M/NA/NT (`bueno_regular_malo_na_nt_obs`), tal como la
 * leyenda del Anexo 14: "B= BUENO  R= REGULAR  M= MALO  NA= NO APLICA
 * NT= NO TIENE". Regular puntúa 0.5; NA y NT salen del denominador. Antes se
 * aplanaba a `cumple_nocumple_na_obs`, que colapsaba R con M y confundía
 * "no aplica" con "no tiene" — dos cosas distintas para el auditor.
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
      'Marca Bueno / Regular / Malo · N/A si el ítem no aplica al contenedor · No tiene si el componente no existe. Regular y Malo exigen observación. Los ítems críticos (soportes de levante, cadenas de fijación) en Malo requieren acción de prioridad alta.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'soportes_levante',       label: 'Soportes de levante.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'cadenas_fijacion',       label: 'Cadenas de fijación.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'puerta_lateral_volteo',  label: 'Puerta lateral o de volteo.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'puerta_escotilla',       label: 'Puerta escotilla.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'seguro_puertas',         label: 'Seguro de puertas.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'sellos_hermerticos',     label: 'Sellos de puertas herméticos.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'moderado',
      },
      { id: 'bisagras_puertas',       label: 'Bisagras de puertas.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'grave',
      },
      { id: 'letreros',               label: 'Letreros.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'moderado',
      },
      { id: 'aletas_seguridad',       label: 'Aletas de seguridad.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'rodillos',               label: 'Ruedas.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'grave',
      },
      { id: 'escalas_accesos',        label: 'Escalas de accesos.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'grave',
      },
      { id: 'estructura_barrotes',    label: 'Estructura apoya barrotes.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'estado_vigas',           label: 'Estado de vigas.', kind: 'bueno_regular_malo_na_nt_obs',
        danoPotencial: 'fatal',
      },
      { id: 'estado_general',         label: 'Estado general del contenedor.', kind: 'bueno_regular_malo_na_nt_obs',
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
