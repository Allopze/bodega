"use client"

import Link from "next/link"
import { MapPin } from "@phosphor-icons/react/dist/ssr"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableCellNum,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/components/ui/table"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { filterGpsPositions, formatGpsMeter } from "./fleet-gps-format"
import { gpsSignalLabel, gpsSourceLabel, ignitionMeta } from "./fleet-gps-labels"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"

export function FleetGpsTable({ positions }: { positions: FleetGpsPosition[] }) {
  const { searchQuery } = useSafeShellHeader()
  const rows = filterGpsPositions(positions, searchQuery)

  if (positions.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay vehículos vinculados"
        description="Configura OnWay o Wialon y actualiza; las patentes deben coincidir con Flota."
        action={<Button asChild variant="secondary" size="sm"><Link href="/flota">Revisar vehículos</Link></Button>}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="Ningún vehículo coincide"
        description="Prueba otra patente, código, marca, modelo o faena en el filtro superior."
      />
    )
  }

  return (
    <TableRoot stickyHeader={rows.length > 20} framed={false} className="border-t border-[var(--color-border)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vehículo</TableHead>
            <TableHead>Faena</TableHead>
            <TableHead>Fuente</TableHead>
            <TableHead>Encendido</TableHead>
            <TableHead className="text-right">Velocidad</TableHead>
            <TableHead>Señal / medidor</TableHead>
            <TableHead>Captura / hora GPS</TableHead>
            <TableHead><span className="sr-only">Mapa</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((position) => (
            <TableRow key={position.id}>
              <TableCell>
                <VehicleIdentity
                  code={position.code}
                  plate={position.plate}
                  type={position.typeName}
                  href={vehicleFichaHref(position.vehicleId)}
                />
              </TableCell>
              <TableCell>{position.worksiteName}</TableCell>
              <TableCell>
                {/* Neutral: la fuente es un dato, no un estado; «signal» es naranja de pendiente. */}
                <MetaBadge meta={{ label: gpsSourceLabel(position), variant: "neutral" }} />
              </TableCell>
              <TableCell>
                <MetaBadge meta={ignitionMeta(position)} dot />
              </TableCell>
              <TableCellNum>{Math.round(position.speedKph)} km/h</TableCellNum>
              <TableCell>
                <div>{gpsSignalLabel(position)}</div>
                <div className="text-xs text-[var(--color-text-subtle)]">
                  {formatGpsMeter(position)}
                  {position.driverName ? ` · ${position.driverName}` : ""}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <div>{formatDateTime(position.observedAt)}</div>
                <div className="text-xs text-[var(--color-text-subtle)]">
                  {position.gpsReportedAt ? (
                    <>
                      GPS: {formatDateTime(position.gpsReportedAt)}
                      {position.gpsIsStale ? <span className="ml-2 font-semibold text-[var(--color-warning-ink)]">Dato atrasado</span> : null}
                    </>
                  ) : "Hora GPS no disponible"}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={`https://www.google.com/maps?q=${position.latitude},${position.longitude}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Abrir ubicación de ${position.plate} en el mapa`}
                  >
                    <MapPin size={15} aria-hidden />
                    Mapa
                  </a>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
