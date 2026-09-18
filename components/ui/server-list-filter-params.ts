/**
 * Qué parámetros de URL cuentan como "filtro de lista" en el repositorio.
 *
 * Vive en un módulo **sin** `"use client"` a propósito. La constante nació
 * dentro de `server-list-filters.tsx`, que sí lo lleva, y desde ahí la importaba
 * `app/(app)/solicitudes/urgency-signal.ts`, que corre en el servidor: Next
 * reemplaza cada export de un módulo cliente por una referencia de cliente, así
 * que en el servidor `SERVER_LIST_FILTER_PARAMS` no era el arreglo sino un
 * proxy, y `/solicitudes` reventaba al renderizar con
 * `TypeError: SERVER_LIST_FILTER_PARAMS is not iterable`.
 *
 * El fallo sólo se ve en una build real —Vitest ignora la directiva y el módulo
 * se comporta como cualquier otro—, y lo destapó la suite E2E: `/solicitudes`
 * caía en su límite de error y con ella los recorridos de EPP, correlativos y
 * el flujo de cuatro módulos.
 *
 * Todo lo que necesite estos valores desde el servidor debe importarlos de acá.
 * `server-list-filters.tsx` los reexporta para que el lado cliente no cambie.
 */
export const SERVER_LIST_FILTER_PARAMS = [
  "q", "estado", "urgencia", "faena", "proveedor", "factura", "desde", "hasta", "solicitud",
] as const

interface SearchParamsLike {
  get(name: string): string | null
}

export function hasServerListFilters(searchParams: SearchParamsLike): boolean {
  return SERVER_LIST_FILTER_PARAMS.some((key) => Boolean(searchParams.get(key)))
}
