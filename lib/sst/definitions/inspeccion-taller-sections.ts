import type { ChecklistSection } from '../types'

/**
 * Inspección Taller de Mantención y Bodega de Acopio RESPEL — módulo 06.
 *
 * Fuente: `docx revisado/06-inspeccion-taller-mantencion.md`.
 * Actividad PDTP 2026: n=27 ("Inspección taller de mantención y bodega de
 * acopio RESPEL").
 *
 * Patrón B (single-sujeto): una instancia por faena/mes (subjectId='').
 *
 * Normalización de la escala del markdown:
 *   Si/No/Pa/Na  (ítems 1-11)  ┐
 *   Si/No/CP/Na  (ítems 12-16) ┘ →  cumple / no_cumple / no_cumple+obs / na
 *
 * "Pa" y "CP" (Cumple Parcialmente) colapsan a `no_cumple`; el matiz se
 * registra en `observacion` y la acción correctiva se captura en línea
 * (`hasActionCorrectiva: true`). Ver PLAN_INTEGRACION §5 (regla de
 * normalización) y §14 default #6.
 *
 * Se usa `cumple_nocumple_na_obs` (no `si_no_obs`) para preservar el botón
 * N/A: varios ítems del taller pueden no aplicar según el rubro de la faena
 * (p.ej. cilindros de oxicorte, pozos, medios mecánicos de carga). Sin N/A,
 * el inspector se ve forzado a marcar `no_cumple` (genera una acción falsa)
 * o a dejar el ítem en blanco.
 */
export const TALLER_SECTIONS: ChecklistSection[] = [
  {
    id: 'verificacion_taller',
    title: 'Verificación de condiciones del taller de mantención y bodega de acopio',
    description:
      'Responda Cumple / No cumple / N/A. Si marca "No cumple", describa la observación y la acción correctiva en los campos habilitados. "Cumple parcialmente" se registra como No cumple con el detalle en la observación.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'lugares_senalizados',         label: '¿Están los lugares de trabajo señalizados de acuerdo a los riesgos existentes?', kind: 'cumple_nocumple_na_obs' },
      { id: 'elementos_estructurales',     label: '¿Se mantienen en condiciones seguras y en buen funcionamiento los elementos estructurales, máquinas, instalaciones, herramientas y equipos?', kind: 'cumple_nocumple_na_obs' },
      { id: 'libres_obstaculos',           label: '¿Se mantienen libres de obstáculos el lugar de trabajo, así como los pasillos de circulación? (limpios y ordenados, para evitar tropiezos, golpes y caídas)', kind: 'cumple_nocumple_na_obs' },
      { id: 'senalizacion_epp',            label: '¿Existe señalización de uso obligatorio de EPP en las distintas áreas de trabajo?', kind: 'cumple_nocumple_na_obs' },
      { id: 'proteccion_partes_moviles',   label: '¿Se encuentran protegidas las partes móviles, transmisiones y puntos de operación de herramientas y equipos?', kind: 'cumple_nocumple_na_obs' },
      { id: 'ropa_suelta_cabello',         label: '¿Se prohíbe a los trabajadores cuya labor se ejecuta cerca de maquinarias en movimiento, el uso de ropa suelta y cabello largo?', kind: 'cumple_nocumple_na_obs' },
      { id: 'procedimientos_seguros',      label: '¿Se cumplen los procedimientos de trabajo seguro al interior del taller (labores de soldadura, corte de metales o similares)?', kind: 'cumple_nocumple_na_obs' },
      { id: 'capacitacion_procedimientos', label: '¿Los trabajadores conocen o han sido capacitados en estos procedimientos de trabajo seguro?', kind: 'cumple_nocumple_na_obs' },
      { id: 'biombos_areas_seguras',       label: '¿Existen biombos y/o áreas de trabajo seguras para labores que expongan a riesgos a personal aledaño? (soldaduras, cortes, desbastes, etc.)', kind: 'cumple_nocumple_na_obs' },
      { id: 'apuntalamiento_chasis',       label: '¿Se cuenta con los apoyos de apuntalamiento necesarios para los trabajos bajo el chasis de una máquina? (gatas hidráulicas, banquillos metálicos)', kind: 'cumple_nocumple_na_obs' },
      { id: 'escaleras_condicion',         label: '¿Las escaleras se mantienen en condiciones seguras y en buen funcionamiento?', kind: 'cumple_nocumple_na_obs' },
      { id: 'accesos_pozos',               label: '¿Los accesos a los pozos cuentan con buena iluminación, escalera con goma antideslizante y pasamanos?', kind: 'cumple_nocumple_na_obs' },
      { id: 'medios_mecanicos_carga',      label: '¿Se dispone de medios mecánicos para cargar materiales que superan los 25 kg (hombres) y 20 kg (mujeres)?', kind: 'cumple_nocumple_na_obs' },
      { id: 'pozos_demarcados',            label: '¿Los pozos se encuentran demarcados con pintura de alto tráfico?', kind: 'cumple_nocumple_na_obs' },
      { id: 'material_inerte_liquidos',    label: '¿Se cuenta con material inerte para absorber líquidos, aceites u otros esparcidos en las superficies de trabajo?', kind: 'cumple_nocumple_na_obs' },
      { id: 'cilindros_almacenamiento',    label: '¿Los cilindros utilizados para oxicorte, GLP u otros se encuentran bien almacenados?', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'observaciones_taller',
    title: 'Observaciones generales',
    description: 'Registro libre de hallazgos adicionales, medidas preventivas o compromisos detectados durante la inspección.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales de la inspección del taller',
        kind: 'text',
        placeholder: 'Describa observaciones, medidas preventivas o compromisos…',
      },
    ],
  },
]
