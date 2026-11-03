"use client"

import Link from "next/link"
import { Warning } from "@phosphor-icons/react"
import { Tooltip } from "@/components/ui/tooltip"
import { inboxRowKey } from "@/lib/combustibles/inbox/types"
import { fuelInboxHref } from "@/lib/combustibles/routes"
import { formatQty } from "@/lib/utils"
import type { getFleetOverview } from "@/lib/services/fleet"

type VehicleRow = Awaited<ReturnType<typeof getFleetOverview>>[number]

const formatNumber = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

/**
 * Celda «Km/Hr» de Flota: la última lectura del medidor tal cual (odómetro en km y, a falta de él,
 * horómetro en h). Cuando el detector de anomalías tiene un caso abierto sobre ESA lectura
 * (`lastReadingObjection`), un triángulo de aviso a su lado lleva al caso en «Por revisar». El aviso no
 * corrige ni oculta la cifra —una lectura de «1 km» se sigue viendo—, sólo dice que alguien debe mirarla.
 */
export function FleetMeterReading({ vehicle }: { vehicle: Pick<VehicleRow, "lastOdometerReading" | "lastHourMeterReading" | "lastReadingObjection"> }) {
  const reading = vehicle.lastOdometerReading != null
    ? `${formatNumber(vehicle.lastOdometerReading)} km`
    : vehicle.lastHourMeterReading != null
      ? `${formatNumber(vehicle.lastHourMeterReading)} h`
      : null
  if (reading === null) return <>—</>

  const objection = vehicle.lastReadingObjection
  if (!objection) return <>{reading}</>

  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <Tooltip content={`Lectura objetada: ${objection.ruleLabel}. Revisar caso.`} side="top">
        <Link
          href={fuelInboxHref({ tipo: "caso", item: inboxRowKey("caso", objection.caseId) })}
          className="inline-flex items-center rounded-sm text-[var(--color-warning-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          <Warning weight="fill" className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Lectura objetada: revisar caso</span>
        </Link>
      </Tooltip>
      {reading}
    </span>
  )
}
