"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { DataTable } from "@/components/ui/data-table"
import { RECEPCION_PAGE_SIZE } from "@/lib/constants"
import { hasServerListFilters, ServerListFilters, type ServerListFilterOption } from "@/components/ui/server-list-filters"
import { StageTabs, type StageTab } from "@/components/ui/stage-tabs"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { TableRow, TableCell } from "@/components/ui/table"
import { StateBadge } from "@/components/states/state-badge"
import { StateLegend } from "@/components/states/state-legend"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { canRegisterReceiptForOrder } from "./recepcion-table.helpers"

type OrderRow = {
  id:          string
  code:        string
  worksiteId:  string
  supplierId:  string
  status:      string
  deliveryMode: string
  sentAt:      string | null
  createdAt:   string
}

export type ReceiptGuideRow = {
  id: string
  code: string
  status: string
  totalQuantity: number
  receivedQuantity: number
}

interface RecepcionTableProps {
  orders:           OrderRow[]
  wsMap:            Record<string, string>
  supMap:           Record<string, string>
  gapMap:           Record<string, number>
  guideMap:         Record<string, ReceiptGuideRow[]>
  canOffice:        boolean
  canFaena:         boolean
  officeName:       string
  worksiteOptions?: ServerListFilterOption[]
  supplierOptions?: ServerListFilterOption[]
  stageTabs?:       StageTab[]
}

// A-20: "Enviada" era a la vez un valor de la columna Estado y el nombre de una
// columna de fecha, en la misma fila. Y "En tránsito" contenía "pend. faena",
// vocabulario distinto del encabezado. Los nombres dicen ahora qué contienen.
const COLUMNS = [
  { key: "code",         label: "OC",             sortable: true,  width: "w-36" },
  // Se ordena por el nombre resuelto, no por el id: la fila lleva el UUID y el
  // nombre se resuelve al pintar, así que ordenar por `worksiteId` daba un orden
  // sin relación con lo que se ve en pantalla.
  { key: "worksiteName", label: "Faena",          sortable: true  },
  { key: "supplierName", label: "Proveedor",      sortable: true  },
  { key: "status",       label: "Estado",         sortable: true,  width: "w-40" },
  { key: "transit",      label: "Pend. de faena", sortable: false, width: "w-32" },
  { key: "sentAt",       label: "Fecha de envío", sortable: true,  width: "w-32" },
  // A-35: "Recibir" estaba pegado al badge de estado y se leía como parte de él.
  // Las acciones van al final de la fila, que es donde se las busca.
  { key: "actions",      label: "",               sortable: false, width: "w-28" },
]
const EMPTY_FILTER_OPTIONS: ServerListFilterOption[] = []
const EMPTY_STAGE_TABS: StageTab[] = []

export function RecepcionTable({ orders, wsMap, supMap, gapMap, guideMap, canOffice, canFaena, officeName, worksiteOptions = EMPTY_FILTER_OPTIONS, supplierOptions = EMPTY_FILTER_OPTIONS, stageTabs = EMPTY_STAGE_TABS }: RecepcionTableProps) {
  const router = useRouter()

  const searchParams = useSearchParams()
  const hasActiveFilters = hasServerListFilters(searchParams)

  // Nombres resueltos en la fila para que el orden de esas columnas coincida con
  // lo que se lee (ver COLUMNS).
  const rows = React.useMemo(
    () => orders.map((o) => ({
      ...o,
      worksiteName: wsMap[o.worksiteId] ?? o.worksiteId,
      supplierName: supMap[o.supplierId] ?? o.supplierId,
    })),
    [orders, wsMap, supMap],
  )

  return (
    <div className="flex flex-col gap-4">
    <OnboardingHint
      storageKey="hint_recepcion_v1"
      title="Recepción de órdenes de compra"
        body={`Registra la llegada en dos pasos cuando la entrega es vía oficina: primero en ${officeName} (botón 'Recibir'), luego la recepción en faena. Las OC de despacho directo a faena se reciben en un solo paso. El indicador «Pendiente de recepción en faena» muestra ítems que ya llegaron a oficina pero aún no se despacharon.`}
    />
    <StateLegend officeName={officeName} />
    {stageTabs.length > 0 && <StageTabs tabs={stageTabs} ariaLabel="Etapa de la recepción" />}
    <ServerListFilters
      searchPlaceholder="Buscar por código o proveedor..."
      worksiteOptions={worksiteOptions}
      supplierOptions={supplierOptions}
    />
    <DataTable
      caption="Órdenes de compra en recepción"
      columns={COLUMNS}
      rows={rows}
      searchKeys={["code"]}
      disableInternalSearch
      pageSize={RECEPCION_PAGE_SIZE}
      emptyTitle="Sin OCs en recepción"
      emptyDescription={hasActiveFilters
        ? "No hay órdenes que coincidan con los filtros aplicados."
        : "No hay órdenes en esta etapa de recepción."}
      emptyAction={hasActiveFilters ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => router.replace("/recepcion", { scroll: false })}>
          Limpiar filtros
        </Button>
      ) : undefined}
      renderRow={(o) => {
        const href = `/compras/${o.id}`
        const canRegisterOrder = canRegisterReceiptForOrder(o.deliveryMode, o.status, canOffice, canFaena)
        const guides = guideMap[o.id] ?? []
        const activeGuide = guides.find((guide) => ["draft", "dispatched", "partially_received"].includes(guide.status))
        return (
          <TableRow
            key={o.id}
            className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
            /* La fila conserva su rol implícito `row`: con role="link" encima, sus
               celdas quedaban sin padre `row` (axe aria-required-parents) y la tabla
               dejaba de anunciarse como tabla. El clic sigue como comodidad de
               mouse; el destino accesible por teclado es el enlace del código. */
            onClick={() => router.push(href)}
          >
            <TableCell>
              <Link
                href={href}
                aria-label={`Ver OC ${o.code}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-xs text-(--color-text) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
                >{o.code}</Link>
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {wsMap[o.worksiteId] ?? o.worksiteId}
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {supMap[o.supplierId] ?? o.supplierId}
            </TableCell>
            <TableCell>
              <StateBadge state={o.status} entity="oc" size="sm" />
            </TableCell>
            <TableCell>
              {activeGuide?.status === "draft"
                ? <Badge variant="warning" size="sm">Pendiente de despacho</Badge>
                : activeGuide?.status === "dispatched"
                  ? <Badge variant="info" size="sm">En traslado</Badge>
                  : activeGuide?.status === "partially_received"
                    ? <Badge variant="danger" size="sm">Diferencia en faena</Badge>
                    : (gapMap[o.id] ?? 0) > 0
                      ? <Badge variant="warning" size="sm">{gapMap[o.id]} {gapMap[o.id] === 1 ? "ítem" : "ítems"}</Badge>
                      : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {o.sentAt ? formatDate(o.sentAt) : "—"}
            </TableCell>
            <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
              {activeGuide ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/bodega/guias/${activeGuide.id}`}>
                    {activeGuide.status === "draft" ? "Completar guía" : "Cotejar"}
                  </Link>
                </Button>
              ) : canRegisterOrder && (
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/recepcion/nueva?oc=${o.id}`}>Recibir</Link>
                </Button>
              )}
            </TableCell>
          </TableRow>
        )
      }}
      /* A-1: sin esto, en 390px se veían 3 de 6 columnas y "Recibir" —la acción
         principal del módulo, que se usa en faena— quedaba fuera de pantalla. */
      renderMobileCard={(o) => {
        const href = `/compras/${o.id}`
        const gap = gapMap[o.id] ?? 0
        const canRegisterOrder = canRegisterReceiptForOrder(o.deliveryMode, o.status, canOffice, canFaena)
        const guides = guideMap[o.id] ?? []
        const activeGuide = guides.find((guide) => ["draft", "dispatched", "partially_received"].includes(guide.status))
        return (
          <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={href} className="min-w-0">
                <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{o.code}</p>
                <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">
                  {supMap[o.supplierId] ?? o.supplierId}
                </p>
              </Link>
              <StateBadge state={o.status} entity="oc" size="sm" />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-[var(--color-text-subtle)]">Faena</dt>
              <dd className="min-w-0 break-words text-right text-[var(--color-text)]">{wsMap[o.worksiteId] ?? o.worksiteId}</dd>
              <dt className="text-[var(--color-text-subtle)]">Enviada</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{o.sentAt ? formatDate(o.sentAt) : "—"}</dd>
            </dl>
            {gap > 0 && (
              <div className="mt-2">
                <Badge variant="warning" size="sm">
                  {gap} {gap === 1 ? "ítem pendiente de recepción en faena" : "ítems pendientes de recepción en faena"}
                </Badge>
              </div>
            )}
            {activeGuide ? (
              <Button variant="primary" size="sm" asChild className="mt-3 w-full">
                <Link href={`/bodega/guias/${activeGuide.id}`}>
                  {activeGuide.status === "draft" ? "Completar despacho" : "Cotejar entrega en faena"}
                </Link>
              </Button>
            ) : canRegisterOrder && (
              <Button variant="primary" size="sm" asChild className="mt-3 w-full">
                <Link href={`/recepcion/nueva?oc=${o.id}`}>Recibir</Link>
              </Button>
            )}
          </article>
        )
      }}
    />
    </div>
  )
}
