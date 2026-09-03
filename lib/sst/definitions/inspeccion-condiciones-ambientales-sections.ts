import type { ChecklistSection } from '../types'

/**
 * Verificación de condiciones ambientales básicas — DS N°594 (hoy Ley
 * 21.512, Título III "Condiciones sanitarias y ambientales básicas en los
 * lugares de trabajo").
 *
 * Actividad PDTP 2026: n=10 ("Verificar el cumplimiento de las condiciones
 * ambientales básicas en los lugares de trabajo, según lo establecido en el
 * DS Nº 594"). No hay anexo/formulario fuente del cliente para este
 * instrumento (a diferencia de los otros once de `PDTP_2026_INSPECTION_SPECS`,
 * que sí transcriben un anexo real): el contenido se escribe directo desde el
 * texto legal, cubriendo los artículos que efectivamente hablan de
 * "condiciones básicas" — agua potable, servicios higiénicos, vestidores,
 * comedor, disposición de residuos, ventilación, iluminación, orden y aseo.
 *
 * Deliberadamente NO se incluye ruido (protocolo PREXOR, N°46) ni temperatura
 * extrema (protocolo frío/calor): esos ya tienen su propio instrumento de
 * higiene industrial y duplicarlos aquí mediría dos veces lo mismo.
 *
 * Mismo patrón que `inspeccion-taller-sections.ts`: `cumple_parcial_nocumple_na_obs`
 * para no forzar "no cumple" cuando la instalación (duchas, comedor) no
 * existe porque la faena no la requiere.
 */
export const CONDICIONES_AMBIENTALES_SECTIONS: ChecklistSection[] = [
  {
    id: 'condiciones_ambientales_basicas',
    title: 'Condiciones sanitarias y ambientales básicas',
    description:
      'Responda Cumple / Cumple parcialmente / No cumple / N/A. Parcial y No cumple requieren observación.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'agua_potable',              label: '¿Se dispone de agua potable suficiente para el consumo humano, de fácil acceso y protegida de contaminación? (art. 11-12)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'excusados_cantidad',        label: '¿La faena cuenta con excusados en cantidad suficiente según la dotación (1 cada 10 trabajadores u otra proporción legal), separados por sexo cuando corresponde? (art. 21)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'excusados_estado',          label: '¿Los excusados y urinarios se mantienen limpios, con puertas, en buen estado de funcionamiento y con papel higiénico disponible?', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'duchas_agua_caliente',      label: '¿Cuando el trabajo ensucia el cuerpo o expone a sustancias tóxicas, se dispone de duchas con agua fría y caliente en cantidad suficiente? (art. 24-27)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'vestidores_guardarropia',   label: '¿Existen vestidores o un recinto con casilleros individuales (guardarropía) para el cambio de ropa y resguardo de pertenencias? (art. 29-30)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'leve',
      },
      { id: 'comedor_condiciones',       label: '¿El comedor o área de colación está separado de las zonas de trabajo, protegido de la intemperie y en condiciones de higiene adecuadas? (art. 28)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'leve',
      },
      { id: 'disposicion_basura',        label: '¿Existen receptáculos suficientes y adecuados para la basura y desperdicios, con retiro periódico que evita su acumulación? (art. 34-39)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'disposicion_residuos_industriales', label: '¿Los residuos industriales (no domésticos) se disponen o eliminan sin riesgo para la salud de los trabajadores ni contaminación del entorno?', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'ventilacion_recintos',      label: '¿Los recintos cerrados de trabajo cuentan con ventilación natural o artificial suficiente para mantener condiciones ambientales adecuadas? (art. 41-53)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'iluminacion_areas_trabajo', label: '¿Las áreas de trabajo, tránsito y accesos cuentan con iluminación suficiente y adecuada a la tarea, natural o artificial? (art. 54-56)', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'orden_aseo_general',        label: '¿Las instalaciones de la faena (comedor, servicios higiénicos, vestidores, oficinas) se mantienen ordenadas, limpias y en buen estado general?', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'leve',
      },
      { id: 'control_plagas',            label: '¿Existe un programa vigente de control de plagas (desratización, desinsectación) aplicable a comedor, bodegas y servicios higiénicos?', kind: 'cumple_parcial_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
    ],
  },
  {
    id: 'observaciones_condiciones_ambientales',
    title: 'Observaciones generales',
    description: 'Registro libre de hallazgos adicionales, medidas preventivas o compromisos detectados durante la verificación.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales de la verificación de condiciones ambientales',
        kind: 'text',
        placeholder: 'Describa observaciones, medidas preventivas o compromisos…',
      },
    ],
  },
]
