/**
 * Labels canónicos de urgencia/severidad.
 *
 * Convención: femenino, porque el sustantivo es «urgencia» («Crítica», «Alta»).
 * Antes se usaba el masculino genérico («Crítico») para que sirviera también a
 * «ítem» o «estado», pero en pantalla la misma urgencia se leía «CRÍTICO» en la
 * insignia, «Urgencia crítica» en la cabecera y «Crítica» en el Inicio. Estas
 * etiquetas rotulan siempre una urgencia; lo que no es urgencia (riesgo, estado,
 * severidad de un hallazgo) tiene sus propios mapas.
 *
 * Esta es la única fuente de verdad. Reemplaza los maps locales en
 * solicitudes/request-list.tsx, solicitudes/request-form.constants.ts,
 * aprobaciones/types.ts y reports/export-module/labels.ts.
 */
export const URGENCY_LABELS = {
  normal:   "Normal",
  high:     "Alta",
  critical: "Crítica",
} as const

export type Urgency = keyof typeof URGENCY_LABELS

export function urgencyLabel(urgency: string | null | undefined): string {
  if (!urgency) return "—"
  return URGENCY_LABELS[urgency as Urgency] ?? urgency
}

/** Lista de opciones para selects. Mismo orden en todos los formularios. */
export const URGENCY_OPTIONS: ReadonlyArray<{ value: Urgency; label: string }> =
  (Object.entries(URGENCY_LABELS) as [Urgency, string][]).map(([value, label]) => ({ value, label }))
