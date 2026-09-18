import { SERVER_LIST_FILTER_PARAMS } from "@/components/ui/server-list-filter-params"

/**
 * REQ-004 (auditoría 2026-09-14): la señal "Urgencia crítica" del encabezado
 * enlazaba a un `/solicitudes?urgencia=critical` FIJO. Dos consecuencias:
 *
 * 1. El salto descartaba el contexto en pantalla (búsqueda, faena, período,
 *    pestaña de etapa), así que la lista de destino no era el subconjunto
 *    crítico de lo que se estaba mirando sino otra población.
 * 2. No había salida: pulsada la señal, `urgencia=critical` quedaba en la URL
 *    sin control que lo quitara.
 *
 * Este helper construye el destino conservando el resto de los filtros y
 * devuelve además si el filtro ya está puesto, para que `HeaderSignals` lo
 * marque como activo y su href sea la SALIDA — el mismo contrato `active` que
 * el componente ya declara (`components/ui/header-signals.tsx`).
 *
 * No inventa política: los parámetros que se conservan son exactamente los que
 * `SERVER_LIST_FILTER_PARAMS` declara como filtros de lista en el repo. `page`
 * se descarta a propósito: cambiar el conjunto invalida el número de página,
 * igual que hace `ServerListFilters` al aplicar cualquier filtro.
 */
export const CRITICAL_URGENCY = "critical"

export function buildUrgencySignal(
  sp: Record<string, string | string[] | undefined>,
): { href: string; active: boolean } {
  const params = new URLSearchParams()
  for (const key of SERVER_LIST_FILTER_PARAMS) {
    if (key === "urgencia") continue
    const raw = sp[key]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value) params.set(key, value)
  }

  const rawUrgency = sp.urgencia
  const active = (Array.isArray(rawUrgency) ? rawUrgency[0] : rawUrgency)?.trim() === CRITICAL_URGENCY
  // Activo ⇒ el href es la misma vista SIN el filtro; inactivo ⇒ lo agrega.
  if (!active) params.set("urgencia", CRITICAL_URGENCY)

  const query = params.toString()
  return { href: query ? `/solicitudes?${query}` : "/solicitudes", active }
}
