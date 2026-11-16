"use client"

import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"
import { cn, formatDateTime } from "@/lib/utils"
import { filterGpsPositions } from "./fleet-gps-format"
import { ignitionMeta } from "./fleet-gps-labels"

/**
 * La flota al lado del mapa, en pantallas anchas (crítica 2026-11-15). Con el mapa arriba y la tabla
 * de ocho columnas debajo, a 1440×900 la lista de vehículos quedaba bajo el pliegue aunque el mapa
 * se achicara: arriba van las cifras, el estado de las fuentes y las pestañas. Esta lista compacta
 * (vehículo, encendido, hora GPS) ocupa el alto del mapa y elegir un vehículo lo ubica en él; la
 * tabla completa sigue debajo para el detalle. Usa la misma búsqueda de la barra superior.
 */
export function FleetGpsSideList({ positions, selectedId, onSelect }: {
  positions: FleetGpsPosition[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { searchQuery } = useSafeShellHeader()
  const rows = filterGpsPositions(positions, searchQuery)
  return (
    <section aria-labelledby="gps-side-list-title" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <h2 id="gps-side-list-title" className="border-b border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
        Vehículos <span className="font-normal text-[var(--color-text-muted)] tabular-nums">· {rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-[var(--color-text-muted)]">Ningún vehículo calza con la búsqueda.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
          {rows.map((position) => {
            const selected = position.id === selectedId
            return (
              <li key={position.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Ubicar ${position.code ?? position.plate} en el mapa`}
                  onClick={() => onSelect(position.id)}
                  className={cn(
                    "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2",
                    selected && "bg-[var(--color-nav-active-bg)]",
                  )}
                >
                  <span className="min-w-0">
                    <VehicleIdentity code={position.code} plate={position.plate} type={position.typeName} />
                    <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">
                      {position.gpsReportedAt ? <>GPS {formatDateTime(position.gpsReportedAt)}</> : "Hora GPS no disponible"}
                      {position.gpsIsStale ? <span className="ml-1 font-semibold text-[var(--color-warning-ink)]">· atrasado</span> : null}
                    </span>
                  </span>
                  <MetaBadge meta={ignitionMeta(position)} size="sm" className="shrink-0" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
