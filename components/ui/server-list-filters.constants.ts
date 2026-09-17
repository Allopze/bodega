/**
 * Solo los parámetros de filtro de lista, sin "use client".
 *
 * `server-list-filters.tsx` es un componente cliente: sus exports de función
 * (componentes, `hasServerListFilters`) sí pueden cruzar la frontera RSC
 * porque Next los trata como referencias cliente, pero un valor plano como
 * este array no llega utilizable al lado servidor — ahí es donde
 * `app/(app)/solicitudes/urgency-signal.ts` (un `.ts` sin "use client" que
 * corre dentro de `SolicitudesPage`, un Server Component) lo necesitaba y
 * fallaba con "SERVER_LIST_FILTER_PARAMS is not iterable" en tiempo de
 * ejecución, aunque TypeScript no lo marcara como error.
 */
export const SERVER_LIST_FILTER_PARAMS = [
  "q", "estado", "urgencia", "faena", "proveedor", "factura", "desde", "hasta", "solicitud",
] as const
