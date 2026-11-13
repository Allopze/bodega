import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { MetaBadge } from "@/components/states/state-badge"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { ServerPagination } from "@/components/ui/server-pagination"
import { fuelRecordSourceLabel } from "@/lib/combustibles/source-labels"
import type { PaginationState } from "@/lib/pagination"
import { formatCLP, formatDate, formatQty, MONTH_NAMES } from "@/lib/utils"
import type * as React from "react"

export interface ConsumptionRecordRow {
  id: string
  batchId: string
  patente: string
  numeroTarjetas: number
  numeroTransacciones: number
  cantidadUnidad: number
  monto: number | null
  precioPromedioUnidad: number | null
  rendimientoPromedio: number
  periodoDesde: string
  periodoHasta: string
  fuente: string | null
  vehicle: { id: string; code: string | null; plate: string; type: string; performanceUnit: string } | null
  /** Ficha del equipo, ya con el período y la faena de la pantalla; `null` cuando la patente no está vinculada. */
  equipmentHref: string | null
  /** El archivo del que salió el total; `null` si la sesión no puede abrirlo. */
  batchHref: string | null
}

/** «Octubre 2026» cuando el total cubre un mes; si no, las dos fechas. */
export function consumptionPeriodLabel(desde: string, hasta: string): string {
  if (desde.slice(0, 7) === hasta.slice(0, 7)) {
    const month = Number(desde.slice(5, 7))
    const name = MONTH_NAMES[month - 1]
    if (name) return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${desde.slice(0, 4)}`
  }
  return `${formatDate(desde)} a ${formatDate(hasta)}`
}

/**
 * El rendimiento que informa el proveedor, con su unidad: litros por hora en la
 * maquinaria (horómetro) y kilómetros por litro en el resto. Cero es «no informó».
 */
export function consumptionPerformanceLabel(value: number, performanceUnit: string | null | undefined): string {
  if (!(value > 0)) return "—"
  return formatQty(value, performanceUnit === "liters_per_hour" ? "L/h" : "km/L", { maximumFractionDigits: 2 })
}

/**
 * Totales de tarjeta de Copec por patente y mes. Cada fila es un total
 * informado por el proveedor, no una carga. Una patente sin equipo enlaza a
 * «Por revisar» (`unlinkedHref`), donde se vincula. Equipo y patente van en una
 * sola columna: cuando son lo mismo no se repiten. Bajo `md` cada fila es una tarjeta.
 */
export function ConsumptionDetailTable({
  rows,
  pagination,
  hrefForPage,
  canViewCosts,
  unlinkedHref,
  degraded = false,
  emptyState,
}: {
  rows: ConsumptionRecordRow[]
  pagination: PaginationState
  hrefForPage: (page: number) => string
  canViewCosts: boolean
  unlinkedHref: string
  /** El conteo falló: no se afirma un total. */
  degraded?: boolean
  /** Lo que se muestra sin filas: qué significa, qué hacer y un enlace real (A4). */
  emptyState: React.ReactNode
}) {
  const unlinkedBadge = (
    <Link href={unlinkedHref} title="Vincular esta patente a un equipo, en «Por revisar»"><MetaBadge meta={{ label: "Sin vincular", variant: "signal" }} size="sm" /></Link>
  )
  const equipmentOf = (row: ConsumptionRecordRow) => row.vehicle && row.equipmentHref
    ? <VehicleIdentity code={row.vehicle.code} plate={row.vehicle.plate} type={row.vehicle.type} href={row.equipmentHref} />
    : <span className="inline-flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-medium">{row.patente}</span>{unlinkedBadge}</span>

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        {degraded
          ? "El total no se pudo calcular; se muestra igual la página actual."
          : <><span className="font-mono tabular-nums">{pagination.totalItems.toLocaleString("es-CL")}</span> {pagination.totalItems === 1 ? "total encontrado" : "totales encontrados"}</>}
      </p>

      {rows.length === 0 ? emptyState : (
        <>
          <TableRoot aria-label="Totales por patente y mes" className="hidden md:block">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Tarjetas</TableHead>
                  <TableHead className="text-right">Transacciones</TableHead>
                  <TableHead className="text-right">Litros</TableHead>
                  {canViewCosts && <TableHead className="text-right">Monto</TableHead>}
                  {canViewCosts && <TableHead className="text-right">Precio por litro</TableHead>}
                  <TableHead className="text-right">Rendimiento que informa</TableHead>
                  <TableHead className="w-28"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{equipmentOf(row)}</TableCell>
                    <TableCell>{row.fuente ? fuelRecordSourceLabel(row.fuente) : "—"}</TableCell>
                    <TableCell nowrap>{consumptionPeriodLabel(row.periodoDesde, row.periodoHasta)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatQty(row.numeroTarjetas)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatQty(row.numeroTransacciones)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatQty(row.cantidadUnidad, "L")}</TableCell>
                    {canViewCosts && <TableCell className="text-right font-mono tabular-nums">{formatCLP(row.monto ?? 0)}</TableCell>}
                    {canViewCosts && <TableCell className="text-right font-mono tabular-nums">{row.precioPromedioUnidad != null ? `${formatCLP(row.precioPromedioUnidad)}/L` : "—"}</TableCell>}
                    <TableCell className="text-right font-mono tabular-nums">{consumptionPerformanceLabel(row.rendimientoPromedio, row.vehicle?.performanceUnit)}</TableCell>
                    <TableCell>
                      {row.batchHref ? <Button asChild variant="ghost" size="sm"><Link href={row.batchHref}>Ver archivo</Link></Button> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>

          {/* Celular: una tarjeta por total, con lo que permite decidir. */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <ResponsiveDataListCard
                key={`card:${row.id}`}
                title={row.vehicle && row.equipmentHref ? <Link href={row.equipmentHref}>{row.vehicle.code ?? row.vehicle.plate}</Link> : row.patente}
                description={`${consumptionPeriodLabel(row.periodoDesde, row.periodoHasta)}${row.fuente ? ` · ${fuelRecordSourceLabel(row.fuente)}` : ""}`}
                status={row.vehicle && row.equipmentHref ? undefined : unlinkedBadge}
                actions={row.batchHref ? <Button asChild variant="ghost" size="sm"><Link href={row.batchHref}>Ver archivo</Link></Button> : undefined}
              >
                <ResponsiveDataListField label="Litros"><span className="whitespace-nowrap font-mono tabular-nums">{formatQty(row.cantidadUnidad, "L")}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Transacciones"><span className="font-mono tabular-nums">{formatQty(row.numeroTransacciones)}</span></ResponsiveDataListField>
                {canViewCosts && <ResponsiveDataListField label="Monto"><span className="whitespace-nowrap font-mono tabular-nums">{formatCLP(row.monto ?? 0)}</span></ResponsiveDataListField>}
                <ResponsiveDataListField label="Rendimiento que informa"><span className="whitespace-nowrap font-mono tabular-nums">{consumptionPerformanceLabel(row.rendimientoPromedio, row.vehicle?.performanceUnit)}</span></ResponsiveDataListField>
              </ResponsiveDataListCard>
            ))}
          </div>
        </>
      )}
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} className="mt-3" />
    </div>
  )
}
