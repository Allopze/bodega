"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowSquareOut,
  Clock,
  FileText,
  CheckCircle,
  Truck,
  Buildings,
  HardHat,
} from "@phosphor-icons/react"
import { formatQty, formatDateTime } from "@/lib/utils"
import type { ConsolidatedRow } from "@/lib/services/trazabilidad-consolidated"

interface Props {
  row: ConsolidatedRow
}

export function ConsolidatedTableAccordion({ row }: Props) {
  return (
    <div className="space-y-4">
      {/* 1. Desglose de etapas y pendientes */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Etapa de las cantidades
          </h4>
          <div className="text-xs text-slate-500">
            {row.deliveryMode === "directo_faena" ? "Envío directo a faena" : "Despacho vía oficina central"}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Solicitado */}
          <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
            <span className="text-[11px] text-slate-500 block">Solicitado</span>
            <span className="font-mono text-base font-bold text-slate-900">
              {formatQty(row.requested, row.uom)}
            </span>
          </div>

          {/* En OC / Proveedor */}
          <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
            <span className="text-[11px] text-slate-500 block">En OC con proveedor</span>
            <span className="font-mono text-base font-bold text-blue-700">
              {formatQty(row.inOc, row.uom)}
            </span>
            {row.pendingBreakdown.pendingFromSupplier > 0 && (
              <span className="block text-[10px] text-amber-700 font-medium mt-0.5">
                Faltan {formatQty(row.pendingBreakdown.pendingFromSupplier, row.uom)}
              </span>
            )}
          </div>

          {/* En oficina */}
          <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
            <span className="text-[11px] text-slate-500 block">En oficina central</span>
            <span className="font-mono text-base font-bold text-orange-700">
              {formatQty(row.pendingBreakdown.inOffice, row.uom)}
            </span>
            <span className="block text-[10px] text-slate-400 mt-0.5">
              Recib: {row.receivedOffice} · Desp: {row.dispatched}
            </span>
          </div>

          {/* En tránsito */}
          <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
            <span className="text-[11px] text-slate-500 block">En camino a faena</span>
            <span className="font-mono text-base font-bold text-indigo-700">
              {formatQty(row.pendingBreakdown.inTransit, row.uom)}
            </span>
            <span className="block text-[10px] text-slate-400 mt-0.5">
              Despachado vía GDI
            </span>
          </div>

          {/* En faena sin entregar */}
          <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
            <span className="text-[11px] text-slate-500 block">En faena (por entregar)</span>
            <span className="font-mono text-base font-bold text-cyan-800">
              {formatQty(row.pendingBreakdown.inFaenaAvailable, row.uom)}
            </span>
            <span className="block text-[10px] text-slate-400 mt-0.5">
              Recibido en faena
            </span>
          </div>

          {/* Entregado a usuario */}
          <div className="border border-emerald-100 rounded-lg p-2.5 bg-emerald-50/40">
            <span className="text-[11px] text-emerald-800 font-medium block">Entregado a usuario</span>
            <span className="font-mono text-base font-bold text-emerald-800">
              {formatQty(row.delivered, row.uom)}
            </span>
            <span className="block text-[10px] text-emerald-600 mt-0.5">
              Con comprobante
            </span>
          </div>
        </div>
      </div>

      {/* 2. Historial cronológico (Timeline) */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Trazabilidad cronológica de movimientos
          </h4>
          <Link
            href={`/bodega/trazabilidad/${row.itemId}`}
            className="text-xs text-blue-600 font-semibold hover:underline inline-flex items-center gap-1"
          >
            Ver expediente completo
            <ArrowSquareOut size={12} />
          </Link>
        </div>

        {row.timeline.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            No hay movimientos registrados para este ítem.
          </p>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {row.timeline.map((event) => {
              let Icon = Clock
              let iconBg = "bg-slate-100 text-slate-700"

              if (event.type === "request") {
                Icon = FileText
                iconBg = "bg-blue-100 text-blue-700"
              } else if (event.type === "approval") {
                Icon = CheckCircle
                iconBg = "bg-emerald-100 text-emerald-700"
              } else if (event.type === "purchase_order") {
                Icon = Truck
                iconBg = "bg-purple-100 text-purple-700"
              } else if (event.type === "receipt_office") {
                Icon = Buildings
                iconBg = "bg-orange-100 text-orange-700"
              } else if (event.type === "dispatch_guide") {
                Icon = Truck
                iconBg = "bg-indigo-100 text-indigo-700"
              } else if (event.type === "receipt_faena") {
                Icon = HardHat
                iconBg = "bg-cyan-100 text-cyan-800"
              } else if (event.type === "delivery") {
                Icon = CheckCircle
                iconBg = "bg-emerald-100 text-emerald-800"
              }

              return (
                <div key={event.id} className="relative flex items-start gap-3 text-xs">
                  <span
                    className={`absolute -left-6 top-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white ${iconBg}`}
                  >
                    <Icon size={11} weight="bold" />
                  </span>
                  <div className="flex-1 min-w-0 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-bold text-slate-900">
                        {event.title}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {formatDateTime(event.date)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-slate-600">{event.description}</p>
                    {event.href && (
                      <div className="mt-1">
                        <Link
                          href={event.href}
                          className="text-[11px] text-blue-600 hover:underline font-semibold inline-flex items-center gap-1"
                        >
                          Ver documento original
                          <ArrowSquareOut size={11} />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
