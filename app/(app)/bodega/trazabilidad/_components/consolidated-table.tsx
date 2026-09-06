"use client"

import * as React from "react"
import Link from "next/link"
import {
  CaretDown,
  CaretRight,
  ArrowSquareOut,
} from "@phosphor-icons/react"
import {
  TableRoot,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCellNum,
  TableCaption,
} from "@/components/ui/table"
import { MetaBadge } from "@/components/states/state-badge"
import { formatQty } from "@/lib/utils"
import type { ConsolidatedRequest } from "@/lib/services/trazabilidad-consolidated"
import { ConsolidatedTableAccordion } from "./consolidated-table-accordion"

interface Props {
  requests: ConsolidatedRequest[]
}

/**
 * Tabla consolidada por solicitud (TR-I1, auditoría 2026-09-05).
 *
 * Antes la tabla iteraba ítems mientras la paginación contaba solicitudes: con
 * varias líneas por solicitud el paginador anunciaba "1–N de M" y la tabla
 * mostraba más filas de las esperadas. Ahora cada fila es una solicitud y sus
 * líneas quedan como evidencia expandible dentro de la fila, de modo que lo que
 * se ve coincide con el universo que pagina el servicio.
 */
export function ConsolidatedTable({ requests }: Props) {
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set())

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    // Sin `stickyHeader`: la vista pagina, y ahí el sticky sólo servía para
    // acotar la tabla a `max-h-[70vh]` y abrir un scroll anidado dentro del
    // pozo, que ya es el contenedor de scroll de la app.
    <TableRoot className="hidden md:block">
      <Table>
        <TableCaption className="sr-only">
          Solicitudes de compra y sus órdenes de compra por faena. Cada fila es una
          solicitud; al expandirla se muestran sus líneas y movimientos.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-center" aria-label="Expandir fila" />
            <TableHead>Solicitud</TableHead>
            <TableHead>Solicitante</TableHead>
            <TableHead className="text-right">Líneas</TableHead>
            <TableHead className="text-right">Órdenes</TableHead>
            <TableHead className="text-right">Solicitado</TableHead>
            <TableHead className="text-right">Pendiente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-12 text-right" aria-label="Acciones" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => {
            const isExpanded = expandedIds.has(request.requestId)
            const detailId = `trazabilidad-detalle-${request.requestId}`
            const byUom = request.quantitiesByUom
            const requested = byUom.length <= 1 ? byUom[0]?.requested : null
            const pending = request.pendingTotal

            return (
              <React.Fragment key={request.requestId}>
                <TableRow
                  data-alert={request.alert ? "true" : undefined}
                  // `TableRow` ya trae la transición y el hover por token
                  // (`--color-surface-2`); repetirlos aquí con literales de
                  // paleta era lo que hacía que la fila reaccionara distinto al
                  // resto de las tablas de la app.
                  //
                  // La fila con pendientes NO se tiñe: el saldo ya se anuncia
                  // en la columna "Pendiente" con un Badge `signal` y el estado
                  // en su propio Badge, así que pintar además el fondo repetía
                  // la misma dimensión tres veces (A5) y —al compartir el
                  // `signal-tint` con el badge— lo volvía literalmente
                  // invisible. En la captura de verificación 4 de 5 filas
                  // salían naranjas y las cifras de pendiente sin recuadro.
                  className={`group cursor-pointer ${
                    isExpanded ? "bg-[var(--color-surface-2)] font-medium" : ""
                  }`}
                  onClick={() => toggleRow(request.requestId)}
                >
                  {/* Toggle button */}
                  <TableCell className="w-10 text-center p-0">
                    <button
                      type="button"
                      aria-label={isExpanded ? "Contraer detalle" : "Expandir detalle"}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleRow(request.requestId)
                      }}
                      className="p-2 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] rounded transition-colors"
                    >
                      {isExpanded ? (
                        <CaretDown size={14} weight="bold" />
                      ) : (
                        <CaretRight size={14} weight="bold" />
                      )}
                    </button>
                  </TableCell>

                  {/* Solicitud */}
                  <TableCell className="whitespace-nowrap">
                    <Link
                      href={`/solicitudes/${request.requestId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                      title="Ver solicitud original"
                    >
                      {request.requestCode}
                      <ArrowSquareOut size={12} className="shrink-0" />
                    </Link>
                    <div className="text-[11px] text-[var(--color-text-muted)] truncate" title={request.requesterName}>
                      {request.worksiteName}
                    </div>
                  </TableCell>

                  <TableCell className="text-xs text-[var(--color-text-muted)]">
                    {request.requesterName}
                  </TableCell>

                  <TableCellNum>{request.lineCount}</TableCellNum>

                  <TableCellNum>{request.orderCount}</TableCellNum>

                  <TableCellNum>
                    {requested !== null && requested !== undefined ? (
                      formatQty(requested)
                    ) : (
                      byUom.map((s) => formatQty(s.requested ?? 0)).join(" / ")
                    )}
                  </TableCellNum>

                  {/* Pendiente Total — el naranja `signal` es el token que el
                      sistema reserva justo para pendientes, así que el chip
                      artesanal se reemplaza por el Badge del producto. */}
                  <TableCellNum>
                    {pending !== null && pending > 0 ? (
                      <MetaBadge meta={{ label: formatQty(pending), variant: "signal" }} />
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">0</span>
                    )}
                  </TableCellNum>

                  <TableCell>
                    <MetaBadge meta={{ label: `${request.statusLabel}`, variant: request.statusColor }} />
                  </TableCell>

                  {/* Link al detalle del expediente */}
                  <TableCell className="text-right">
                    <Link
                      href={`/bodega/trazabilidad?tab=documento&codigo=${encodeURIComponent(request.requestCode)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-3)] rounded"
                      title="Buscar el expediente documental de la solicitud"
                    >
                      <ArrowSquareOut size={15} />
                    </Link>
                  </TableCell>
                </TableRow>

                {/* Fila expandible con las líneas de la solicitud */}
                {isExpanded && (
                  <TableRow className="bg-[var(--color-surface-2)]">
                    <TableCell colSpan={9} className="p-4 sm:p-5" id={detailId}>
                      <div className="space-y-4">
                        {request.lines.length === 0 ? (
                          <p className="text-xs text-[var(--color-text-muted)] italic">
                            Esta solicitud no tiene líneas de evidencia para este rango de filtros.
                          </p>
                        ) : (
                          request.lines.map((row) => (
                            <ConsolidatedTableAccordion key={row.itemId} row={row} />
                          ))
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}