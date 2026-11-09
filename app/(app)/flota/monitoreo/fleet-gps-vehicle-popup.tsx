"use client"

import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { formatGpsMeter, movementLabel } from "./fleet-gps-format"

/** Lo que se despliega junto al punto del vehículo en el mapa de Monitoreo GPS. */
export function FleetGpsVehiclePopup({ position }: { position: FleetGpsPosition }) {
  const identity = [position.code, position.brand, position.model].filter(Boolean).join(" · ")
  return (
    <div className="w-64 space-y-3 text-sm text-[var(--color-text)]">
      <div className="pr-6">
        <p className="text-base font-semibold leading-tight">{position.plate}</p>
        {identity ? <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{identity}</p> : null}
      </div>

      <div className="space-y-1">
        <MetaBadge meta={{ label: position.ignition ? "Encendido" : "Apagado", variant: position.ignition ? "success" : "neutral" }} dot />
        <p className="text-xs text-[var(--color-text-muted)]">{movementLabel(position)}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--color-text-subtle)]">Faena</dt>
        <dd>{position.worksiteName}</dd>
        <dt className="text-[var(--color-text-subtle)]">Medidor</dt>
        <dd className="tabular-nums">{formatGpsMeter(position)}</dd>
        {position.driverName ? (
          <>
            <dt className="text-[var(--color-text-subtle)]">Conductor</dt>
            <dd>{position.driverName}</dd>
          </>
        ) : null}
        <dt className="text-[var(--color-text-subtle)]">Hora GPS</dt>
        <dd className="tabular-nums">
          {position.gpsReportedAt ? formatDateTime(position.gpsReportedAt) : "No disponible"}
          {position.gpsIsStale ? <span className="ml-1 font-semibold text-[var(--color-warning-ink)]">Dato atrasado</span> : null}
        </dd>
        <dt className="text-[var(--color-text-subtle)]">Captura</dt>
        <dd className="tabular-nums">{formatDateTime(position.observedAt)}</dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/flota/${encodeURIComponent(position.vehicleId)}`}>Ver ficha</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a
            href={`https://www.google.com/maps?q=${position.latitude},${position.longitude}`}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Abrir la ubicación de ${position.plate} en Google Maps (pestaña nueva)`}
          >
            Google Maps
            <ArrowSquareOut size={14} aria-hidden />
          </a>
        </Button>
      </div>
    </div>
  )
}
