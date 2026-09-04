"use client"

import * as React from "react"
import Link from "next/link"
import {
  CaretDown,
  CaretRight,
  ArrowSquareOut,
  Warning,
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
import { Badge } from "@/components/ui/badge"
import { formatQty } from "@/lib/utils"
import type { ConsolidatedRow } from "@/lib/services/trazabilidad-consolidated"
import { ConsolidatedTableAccordion } from "./consolidated-table-accordion"

interface Props {
  rows: ConsolidatedRow[]
}

export function ConsolidatedTable({ rows }: Props) {
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
    <TableRoot stickyHeader className="hidden md:block">
      <Table>
        <TableCaption className="sr-only">
          Tabla consolidada de seguimiento de solicitudes y materiales por faena. Las cantidades
          están expresadas en la unidad de medida de cada ítem, indicada bajo su nombre.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-center" aria-label="Expandir fila" />
            <TableHead>Ítem / Producto</TableHead>
            <TableHead>Solicitud</TableHead>
            <TableHead className="text-right">Solicitado</TableHead>
            <TableHead className="text-right">En OC</TableHead>
            <TableHead className="text-right">Recib. Oficina</TableHead>
            <TableHead className="text-right">Recib. Faena</TableHead>
            <TableHead className="text-right">Stock Faena</TableHead>
            <TableHead className="text-right">Entregado</TableHead>
            <TableHead className="text-right">Pendiente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-12 text-right" aria-label="Acciones" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isExpanded = expandedIds.has(row.itemId)
            const hasPending = row.pendingTotal > 0
            const detailId = `trazabilidad-detalle-${row.itemId}`

            return (
              <React.Fragment key={row.itemId}>
                <TableRow
                  data-alert={row.alert ? "true" : undefined}
                  className={`group transition-colors hover:bg-slate-50/70 cursor-pointer ${
                    row.alert
                      ? "bg-[var(--color-signal-tint)]/40"
                      : isExpanded
                      ? "bg-slate-50/90 font-medium"
                      : ""
                  }`}
                  onClick={() => toggleRow(row.itemId)}
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
                        toggleRow(row.itemId)
                      }}
                      className="p-2 text-slate-400 hover:text-slate-700 rounded transition-colors"
                    >
                      {isExpanded ? (
                        <CaretDown size={14} weight="bold" />
                      ) : (
                        <CaretRight size={14} weight="bold" />
                      )}
                    </button>
                  </TableCell>

                  {/* Ítem / Producto — la unidad va acá una sola vez: repetirla
                      en las ocho columnas numéricas llenaba cada fila de
                      "unidades" y tapaba los números, que son el dato. */}
                  <TableCell className="max-w-[240px]">
                    <div className="font-semibold text-slate-900 truncate" title={row.productName}>
                      {row.productName}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                      {row.productSku && <span>SKU {row.productSku}</span>}
                      {row.categoryName && <span>· {row.categoryName}</span>}
                      <span>· {row.uom}</span>
                    </div>
                  </TableCell>

                  {/* Solicitud */}
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/solicitudes/${row.requestId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"
                        title="Ver solicitud original"
                      >
                        {row.requestCode}
                        <ArrowSquareOut size={12} className="shrink-0" />
                      </Link>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate" title={row.requesterName}>
                      {row.requesterName}
                    </div>
                  </TableCell>

                  {/* Solicitado */}
                  <TableCellNum className="font-mono text-xs">
                    {formatQty(row.requested)}
                  </TableCellNum>

                  {/* En OC */}
                  <TableCellNum className="font-mono text-xs">
                    <div className="flex items-center justify-end gap-1">
                      <span
                        className={
                          row.pendingBreakdown.notYetOrdered > 0 ? "text-amber-700 font-semibold" : ""
                        }
                      >
                        {formatQty(row.inOc)}
                      </span>
                      {row.alert && (
                        <Warning
                          size={13}
                          weight="fill"
                          className="text-amber-600 shrink-0"
                          aria-label={`Faltan ${formatQty(
                            row.pendingBreakdown.notYetOrdered,
                            row.uom,
                          )} por comprar`}
                        />
                      )}
                    </div>
                  </TableCellNum>

                  {/* Recibido Oficina */}
                  <TableCellNum className="font-mono text-xs text-slate-600">
                    {formatQty(row.receivedOffice)}
                  </TableCellNum>

                  {/* Recibido Faena */}
                  <TableCellNum className="font-mono text-xs text-slate-700 font-medium">
                    {formatQty(row.receivedFaena)}
                  </TableCellNum>

                  {/* Stock en Faena (contextual) */}
                  <TableCellNum className="font-mono text-xs text-slate-500">
                    {row.stockInFaena !== null ? (
                      <span title="Stock físico total del producto en esta faena, de cualquier procedencia — no es el saldo de este ítem">
                        {formatQty(row.stockInFaena)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCellNum>

                  {/* Entregado */}
                  <TableCellNum className="font-mono text-xs font-semibold text-emerald-800">
                    {formatQty(row.delivered)}
                  </TableCellNum>

                  {/* Pendiente Total */}
                  <TableCellNum className="font-mono text-xs">
                    {hasPending ? (
                      <span className="font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                        {formatQty(row.pendingTotal)}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">0</span>
                    )}
                  </TableCellNum>

                  {/* Estado calculado */}
                  <TableCell>
                    <Badge variant={row.computedStatusColor} size="sm">
                      {row.computedStatusLabel}
                    </Badge>
                  </TableCell>

                  {/* Link al detalle completo */}
                  <TableCell className="text-right">
                    <Link
                      href={`/bodega/trazabilidad/${row.itemId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                      title="Ver expediente detallado del ítem"
                    >
                      <ArrowSquareOut size={15} />
                    </Link>
                  </TableCell>
                </TableRow>

                {/* Fila expandible con timeline y desglose */}
                {isExpanded && (
                  <TableRow className="bg-slate-50/60 border-b border-slate-200">
                    <TableCell colSpan={12} className="p-4 sm:p-5" id={detailId}>
                      <ConsolidatedTableAccordion row={row} />
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
