import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { ServerPagination } from "@/components/ui/server-pagination"
import type { PaginationState } from "@/lib/pagination"
import { formatCLP, formatQty, MONTH_NAMES } from "@/lib/utils"

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
  vehicle: { id: string; plate: string; type: string } | null
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
  const flip = (value: string) => value.split("-").reverse().join("-")
  return `${flip(desde)} a ${flip(hasta)}`
}

/**
 * Totales de tarjeta de Copec por patente y mes. Cada fila es un total
 * informado por el proveedor, no una carga. Una patente sin equipo enlaza a
 * «Por revisar» (`unlinkedHref`), donde se vincula.
 */
export function ConsumptionDetailTable({
  rows,
  pagination,
  hrefForPage,
  canViewCosts,
  unlinkedHref,
  degraded = false,
}: {
  rows: ConsumptionRecordRow[]
  pagination: PaginationState
  hrefForPage: (page: number) => string
  canViewCosts: boolean
  unlinkedHref: string
  /** El conteo falló: no se afirma un total. */
  degraded?: boolean
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        {degraded
          ? "El total no se pudo calcular; se muestra igual la página actual."
          : <><span className="font-mono tabular-nums">{pagination.totalItems.toLocaleString("es-CL")}</span> {pagination.totalItems === 1 ? "total encontrado" : "totales encontrados"}</>}
      </p>

      <TableRoot aria-label="Totales por patente y mes" className="-mx-4 w-auto px-4 sm:mx-0 sm:w-full sm:px-0">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Patente</TableHead>
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
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canViewCosts ? 11 : 9} className="py-8 text-center text-[var(--color-text-muted)]">
                  No hay totales de tarjeta para estos filtros
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm font-semibold">{row.patente}</TableCell>
                  <TableCell>
                    {row.vehicle && row.equipmentHref
                      ? <Link href={row.equipmentHref} className="text-[var(--color-primary-ink)] hover:underline">{row.vehicle.plate}</Link>
                      : <Link href={unlinkedHref} title="Vincular esta patente a un equipo, en «Por revisar»"><MetaBadge meta={{ label: "Sin vincular", variant: "signal" }} size="sm" /></Link>}
                  </TableCell>
                  <TableCell>{row.fuente ?? "—"}</TableCell>
                  <TableCell>{consumptionPeriodLabel(row.periodoDesde, row.periodoHasta)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(row.numeroTarjetas)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(row.numeroTransacciones)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(row.cantidadUnidad, "L")}</TableCell>
                  {canViewCosts && <TableCell className="text-right font-mono tabular-nums">{formatCLP(row.monto ?? 0)}</TableCell>}
                  {canViewCosts && <TableCell className="text-right font-mono tabular-nums">{row.precioPromedioUnidad != null ? `${formatCLP(row.precioPromedioUnidad)}/L` : "—"}</TableCell>}
                  <TableCell className="text-right font-mono tabular-nums">{row.rendimientoPromedio > 0 ? row.rendimientoPromedio.toFixed(2) : "—"}</TableCell>
                  <TableCell>
                    {row.batchHref ? <Button asChild variant="ghost" size="sm"><Link href={row.batchHref}>Ver archivo</Link></Button> : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableRoot>
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} className="mt-3" />
    </div>
  )
}
