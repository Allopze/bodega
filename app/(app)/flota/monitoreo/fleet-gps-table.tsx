"use client"

import Link from "next/link"
import { MapPin, Truck } from "@phosphor-icons/react/dist/ssr"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
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
import { formatGpsMeter } from "./fleet-gps-format"

function providerLabel(provider: string): string {
  return provider === "onway" ? "OnWay" : provider === "wialon" ? "Wialon" : provider
}

function sourceLabel(position: FleetGpsPosition): string {
  const sources = position.providers.map(providerLabel).join(" + ") || "Sin fuente"
  return position.meterProvider ? `${sources} · medidor ${providerLabel(position.meterProvider)}` : sources
}

export function FleetGpsTable({ positions }: { positions: FleetGpsPosition[] }) {
  const { searchQuery } = useSafeShellHeader()
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const rows = query
    ? positions.filter((position) => [
        position.plate,
        position.code,
        position.brand,
        position.model,
        position.worksiteName,
        position.providers.join(" "),
      ].some((value) => value?.toLocaleLowerCase("es-CL").includes(query)))
    : positions

  if (positions.length === 0) {
    return (
      <EmptyState
        icon={<Truck size={24} aria-hidden />}
        title="Todavía no hay vehículos vinculados"
        description="Configura OnWay o Wialon, revisa que las patentes o unidades coincidan con el catálogo de Flota y ejecuta una actualización."
        action={<Button asChild variant="secondary" size="sm"><Link href="/flota">Revisar catálogo</Link></Button>}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={<MapPin size={20} aria-hidden />}
        title="Ningún vehículo coincide"
        description="Prueba otra patente, código, marca, modelo o faena en el filtro superior."
      />
    )
  }

  return (
    <TableRoot stickyHeader={rows.length > 20} className="rounded-none border-x-0 border-b-0">
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
                <div className="font-medium">{position.plate}</div>
                <div className="text-xs text-[var(--color-text-subtle)]">
                  {[position.code, position.brand, position.model].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell>{position.worksiteName}</TableCell>
              <TableCell>
                <MetaBadge meta={{ label: sourceLabel(position), variant: position.providers.length > 1 ? "signal" : "neutral" }} />
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: !position.ignitionKnown ? "Sin dato" : position.ignition ? "Encendido" : "Apagado", variant: !position.ignitionKnown ? "neutral" : position.ignition ? "success" : "neutral" }} dot />
              </TableCell>
              <TableCellNum>{Math.round(position.speedKph)} km/h</TableCellNum>
              <TableCell>
                <div>{position.gpsStatus ?? position.sourceStatus ?? "Sin estado GPS"}</div>
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
