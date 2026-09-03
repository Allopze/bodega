"use client"

import * as React from "react"
import Link from "next/link"
import {
  CaretDown,
  CaretRight,
  ArrowSquareOut,
} from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { formatQty, formatDateTime } from "@/lib/utils"
import type { ConsolidatedRow } from "@/lib/services/trazabilidad-consolidated"

interface Props {
  row: ConsolidatedRow
}

export function ConsolidatedCard({ row }: Props) {
  const [isExpanded, setIsExpanded] = React.useState(false)

  return (
    <article
      className={`rounded-2xl border bg-white p-4 shadow-xs transition-shadow ${
        row.alert ? "border-amber-200 bg-amber-50/20" : "border-slate-200/70"
      }`}
    >
      <div
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setIsExpanded(!isExpanded)
          }
        }}
      >
        {/* Encabezado: Producto y Estado */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-slate-900 text-sm truncate" title={row.productName}>
              {row.productName}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono mt-0.5">
              {row.productSku && <span>SKU {row.productSku}</span>}
              {row.categoryName && <span>· {row.categoryName}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant={row.computedStatusColor} size="sm">
              {row.computedStatusLabel}
            </Badge>
            <span className="text-slate-400 p-1">
              {isExpanded ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
            </span>
          </div>
        </div>

        {/* Solicitud info */}
        <div className="mt-2.5 flex items-center justify-between text-xs text-slate-600 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-slate-400">Solicitud:</span>
            <Link
              href={`/solicitudes/${row.requestId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-bold text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              {row.requestCode}
              <ArrowSquareOut size={11} />
            </Link>
          </div>
          <span className="text-slate-500 text-[11px] truncate max-w-[150px]" title={row.requesterName}>
            {row.requesterName}
          </span>
        </div>

        {/* Grid de cantidades principales */}
        <div className="mt-3 grid grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center font-mono">
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">Solic.</span>
            <span className="text-xs font-bold text-slate-800">
              {formatQty(row.requested, row.uom)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">En OC</span>
            <span className="text-xs font-bold text-blue-700">
              {formatQty(row.inOc, row.uom)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">Entreg.</span>
            <span className="text-xs font-bold text-emerald-800">
              {formatQty(row.delivered, row.uom)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">Pend.</span>
            <span
              className={`text-xs font-bold ${
                row.pendingTotal > 0 ? "text-amber-700 font-extrabold" : "text-slate-400"
              }`}
            >
              {formatQty(row.pendingTotal, row.uom)}
            </span>
          </div>
        </div>
      </div>

      {/* Detalle expandible */}
      {isExpanded && (
        <div className="mt-4 pt-3 border-t border-slate-200 space-y-4">
          {/* Desglose de etapas */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Desglose de pendientes por etapa
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-500 block">Pendiente Proveedor</span>
                <span className="font-mono font-bold text-blue-700">
                  {formatQty(row.pendingBreakdown.pendingFromSupplier, row.uom)}
                </span>
              </div>
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-500 block">En Oficina</span>
                <span className="font-mono font-bold text-orange-700">
                  {formatQty(row.pendingBreakdown.inOffice, row.uom)}
                </span>
              </div>
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-500 block">En Camino a Faena</span>
                <span className="font-mono font-bold text-indigo-700">
                  {formatQty(row.pendingBreakdown.inTransit, row.uom)}
                </span>
              </div>
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-500 block">En Faena (Sin Entregar)</span>
                <span className="font-mono font-bold text-cyan-800">
                  {formatQty(row.pendingBreakdown.inFaenaAvailable, row.uom)}
                </span>
              </div>
            </div>
          </div>

          {/* Timeline de movimientos */}
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Historial cronológico
              </h4>
              <Link
                href={`/bodega/trazabilidad/${row.itemId}`}
                className="text-[11px] text-blue-600 font-semibold hover:underline inline-flex items-center gap-1"
              >
                Ver expediente
                <ArrowSquareOut size={11} />
              </Link>
            </div>

            {row.timeline.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Sin movimientos registrados</p>
            ) : (
              <div className="space-y-2.5">
                {row.timeline.map((event) => (
                  <div
                    key={event.id}
                    className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-semibold text-slate-700">{event.title}</span>
                      <span className="font-mono">{formatDateTime(event.date)}</span>
                    </div>
                    <p className="mt-1 text-slate-600 text-[11px]">{event.description}</p>
                    {event.href && (
                      <Link
                        href={event.href}
                        className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:underline"
                      >
                        Ver documento
                        <ArrowSquareOut size={10} />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
