import type { FieldKind, StatusValue } from './types'

/**
 * Qué respuestas admite cada escala del catálogo, con la etiqueta del papel.
 *
 * Vivía dentro de `renderStatusButtons()` en
 * `app/(app)/prevencion/[id]/checklist-section-item.tsx`, así que sólo la veía
 * el motor SST. El motor transversal de Inspecciones la reimplementó
 * incompleta: ofrecía "Cumple / No cumple / No aplica" en todas las escalas,
 * de modo que un Anexo 13 (B/R/M **sin escape**) aceptaba un "No aplica" que
 * el instrumento no tiene —y ese N/A sale del denominador, inflando el
 * cumplimiento— y mostraba "Cumple" donde el papel dice "Bueno".
 *
 * Extraída literal, sin cambiar el mapa: es la fuente única de qué se puede
 * responder y cómo se llama, para los dos motores.
 */
export interface StatusOption {
  value: StatusValue
  label: string
  variant: 'positive' | 'negative' | 'neutral'
}

/** Escalas Bueno/Regular/Malo de los anexos de inspección (3, 13, 14). */
export const BRM_KINDS: readonly FieldKind[] = [
  'bueno_regular_malo_obs',
  'bueno_regular_malo_na_obs',
  'bueno_regular_malo_na_nt_obs',
]

/**
 * Opciones de la escala, en el orden en que se presentan. Un `kind` que no
 * expresa conformidad (text, date, select…) devuelve lista vacía: se responde
 * con su contenido, no con un juicio.
 */
export function statusOptionsForKind(kind: FieldKind | null | undefined): StatusOption[] {
  const options: StatusOption[] = []

  if (kind === 'cumple_nocumple_obs' || kind === 'cumple_nocumple_na_obs') {
    options.push({ value: 'cumple', label: 'Cumple', variant: 'positive' })
    options.push({ value: 'no_cumple', label: 'No cumple', variant: 'negative' })
    if (kind === 'cumple_nocumple_na_obs') {
      options.push({ value: 'na', label: 'N/A', variant: 'neutral' })
    }
  } else if (kind === 'bueno_malo_obs') {
    options.push({ value: 'cumple', label: 'Bueno', variant: 'positive' })
    options.push({ value: 'no_cumple', label: 'Malo', variant: 'negative' })
  } else if (kind === 'cumple_parcial_nocumple_na_obs') {
    options.push({ value: 'cumple', label: 'Cumple', variant: 'positive' })
    options.push({ value: 'regular', label: 'Cumple parcialmente', variant: 'neutral' })
    options.push({ value: 'no_cumple', label: 'No cumple', variant: 'negative' })
    options.push({ value: 'na', label: 'N/A', variant: 'neutral' })
  } else if (kind === 'entregado_obs') {
    options.push({ value: 'entregado', label: 'Entregado', variant: 'positive' })
    options.push({ value: 'no_entregado', label: 'No entregado', variant: 'negative' })
  } else if (kind === 'apto_obs') {
    options.push({ value: 'apto', label: 'Apto', variant: 'positive' })
    options.push({ value: 'no_apto', label: 'No apto', variant: 'negative' })
  } else if (kind === 'si_no_obs' || kind === 'si_no_na_obs') {
    options.push({ value: 'si', label: 'Sí', variant: 'positive' })
    options.push({ value: 'no', label: 'No', variant: 'negative' })
    if (kind === 'si_no_na_obs') {
      options.push({ value: 'na', label: 'N/A', variant: 'neutral' })
    }
  } else if (kind && BRM_KINDS.includes(kind)) {
    // Escala B/R/M de los anexos de inspección. Regular puntúa 0.5.
    options.push({ value: 'cumple', label: 'Bueno', variant: 'positive' })
    options.push({ value: 'regular', label: 'Regular', variant: 'neutral' })
    options.push({ value: 'no_cumple', label: 'Malo', variant: 'negative' })
    if (kind === 'bueno_regular_malo_na_obs' || kind === 'bueno_regular_malo_na_nt_obs') {
      options.push({ value: 'na', label: 'N/A', variant: 'neutral' })
    }
    if (kind === 'bueno_regular_malo_na_nt_obs') {
      // NT = "no tiene" (Anexo 14): el contenedor no posee el componente.
      options.push({ value: 'no_tiene', label: 'No tiene', variant: 'neutral' })
    }
  }

  return options
}

/**
 * ¿La escala ofrece salida por "no aplica"?
 *
 * `cumple_nocumple_obs` y `bueno_regular_malo_obs` NO la tienen: son las
 * escalas sin escape, donde todo ítem se juzga. Distinguirlas importa porque
 * un N/A sale del denominador del cumplimiento.
 */
export function kindAllowsNotApplicable(kind: FieldKind | null | undefined): boolean {
  return statusOptionsForKind(kind).some((option) => option.value === 'na')
}
