import type { TrainingOccurrenceStatusFilter } from "@/lib/services/prevention-training-occurrences"

/**
 * El contrato de URL de la pestaña de estado de `/prevencion/capacitacion`.
 *
 * Es un módulo propio, sin React ni base de datos, porque lo leen DOS lados que
 * deben coincidir letra por letra: la página (servidor) traduce `?estado=` al
 * filtro de la consulta y la lista (cliente) arma las pestañas con los mismos
 * valores. Si cada uno llevara su propia tabla, una pestaña podría escribir un
 * valor que la página no entiende, y la lista caería en silencio a «Pendientes».
 *
 * «Pendientes» es la vista por omisión y por eso su valor es vacío: la pestaña
 * activa sin `estado` en la URL es la primera. `StageTabs` borra el parámetro
 * al elegirla.
 */
export const TRAINING_STATUS_TABS = [
  { value: "", status: "pending", label: "Pendientes" },
  { value: "hecha", status: "completed", label: "Hechas" },
  { value: "no_hecha", status: "not_completed", label: "No hechas" },
  { value: "no_aplica", status: "not_applicable", label: "No aplican" },
  { value: "todas", status: "all", label: "Todas" },
] as const satisfies ReadonlyArray<{ value: string; status: TrainingOccurrenceStatusFilter; label: string }>

/** Valor de `?estado=` que muestra todo el año: lo que escribe una celda del calendario. */
export const TRAINING_ALL_STATUS_PARAM = "todas"

export type TrainingStatusParam = (typeof TRAINING_STATUS_TABS)[number]["value"]

/**
 * `?estado=` → filtro de la consulta. Ausente o vacío es «Pendientes»; un valor
 * que no es ninguna pestaña (`pendiente`, texto a mano) también, y `known` lo
 * dice para que la página lo normalice en vez de dejar la URL sin pestaña activa.
 */
export function parseTrainingStatusParam(raw: string | string[] | undefined): {
  status: TrainingOccurrenceStatusFilter
  known: boolean
} {
  // Sin `trim`: la pestaña compara el valor literal de la URL, así que un valor
  // con espacios no puede contar como conocido y dejar la pantalla sin pestaña activa.
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? ""
  const tab = TRAINING_STATUS_TABS.find((candidate) => candidate.value === value)
  return tab ? { status: tab.status, known: true } : { status: "pending", known: false }
}

/**
 * «Programa anual 2026 · versión 1»: lo que dice el rótulo del catálogo en
 * pantalla. El identificador (`programa-capacitacion-2026-v1`) es un slug de
 * base de datos y no se le muestra a nadie. Recibe la versión en vez de
 * consultarla para que la lista de cliente no arrastre el catálogo entero
 * (cientos de filas de datos) sólo por un número de versión.
 */
export function programVersionLabel(year: number, catalogVersion: string): string {
  const version = /-v(\d+)$/.exec(catalogVersion)?.[1]
  return version ? `Programa anual ${year} · versión ${version}` : `Programa anual ${year}`
}
