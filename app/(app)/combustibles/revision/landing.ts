/**
 * A qué cola de «Revisión» aterriza la persona que abre el ítem del menú.
 *
 * «Revisión» agrupa dos colas —cargas marcadas del control y casos de
 * anomalía— y el menú apunta a una sola ruta, así que la entrada decide por
 * dónde hay trabajo. Abrir siempre la misma dejaba a quien solo tiene
 * anomalías pendientes frente a una cola vacía, con el trabajo a un clic de
 * distancia y sin saberlo.
 *
 * Sin conteo confiable (`null`: la consulta falló) no se afirma que una cola
 * esté vacía: se cae a las cargas marcadas, que era la entrada de siempre.
 */

export const CARGAS_QUEUE_PATH = "/combustibles/control/revision"
export const ANOMALIAS_QUEUE_PATH = "/combustibles/anomalias"
/** La cola de anomalías se abre en sus casos vigentes: los que cuenta el menú. */
const ANOMALIAS_QUEUE_PARAMS = { estado: "vigentes" }

export interface RevisionLandingCounts {
  flagged: number | null
  anomalies: number | null
}

type SearchParamValue = string | string[] | undefined

/** `?faena=` de la entrada, si viene y no está en blanco. Es el único contexto que comparten las dos colas. */
function faenaParam(value: SearchParamValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

export function revisionLandingHref(counts: RevisionLandingCounts, faena?: SearchParamValue): string {
  const onlyAnomalies = counts.anomalies != null && counts.anomalies > 0 && counts.flagged === 0
  const path = onlyAnomalies ? ANOMALIAS_QUEUE_PATH : CARGAS_QUEUE_PATH
  const params = new URLSearchParams(onlyAnomalies ? ANOMALIAS_QUEUE_PARAMS : {})
  const worksite = faenaParam(faena)
  if (worksite) params.set("faena", worksite)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}
