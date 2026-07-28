"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { DataTable } from "@/components/admin/data-table"
import { ListFilters, type FilterOption } from "@/components/adquisiciones/list-filters"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { TableRow, TableCell } from "@/components/ui/table"
import { StateBadge } from "@/components/states/state-badge"
import { StateLegend } from "@/components/states/state-legend"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"

interface OrderRow {
  id:          string
  code:        string
  worksiteId:  string
  supplierId:  string
  status:      string
  sentAt:      string | null
  createdAt:   string
}

interface RecepcionTableProps {
  orders:           OrderRow[]
  wsMap:            Record<string, string>
  supMap:           Record<string, string>
  gapMap:           Record<string, number>
  canRegister:      boolean
  worksiteOptions?: FilterOption[]
  supplierOptions?: FilterOption[]
}

const COLUMNS = [
  { key: "code",         label: "OC",         sortable: true,  width: "w-36" },
  { key: "worksiteId",   label: "Faena",      sortable: true  },
  { key: "supplierId",   label: "Proveedor",  sortable: true  },
  { key: "status",       label: "Estado",     sortable: true,  width: "w-40" },
  { key: "transit",      label: "En tránsito", sortable: false, width: "w-32" },
  { key: "sentAt",       label: "Enviada",    sortable: true,  width: "w-32" },
]

export function RecepcionTable({ orders, wsMap, supMap, gapMap, canRegister, worksiteOptions = [], supplierOptions = [] }: RecepcionTableProps) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-4">
    <OnboardingHint
      storageKey="hint_recepcion_v1"
      title="Recepción de repuestos, servicios y otros"
      body="Registra la llegada de repuestos, servicios y otros en dos pasos: primero en oficina Chome (botón 'Recibir'), luego el despacho a la faena. El badge 'pend. faena' indica ítems que ya llegaron a oficina pero aún no se enviaron."
    />
    <StateLegend />
    <ListFilters
      searchPlaceholder="Buscar por código o proveedor..."
      worksiteOptions={worksiteOptions}
      supplierOptions={supplierOptions}
      exportTipo="recepcion"
    />
    <DataTable
      caption="Órdenes de Compra Pendientes de Recepción"
      columns={COLUMNS}
      rows={orders as unknown as Record<string, unknown>[]}
      searchKeys={["code"]}
      disableInternalSearch
      pageSize={20}
      emptyTitle="Sin OCs pendientes de recepción"
      emptyDescription="No hay órdenes que coincidan con los filtros."
      renderRow={(row) => {
        const o = row as unknown as OrderRow
        const href = `/compras/${o.id}`
        return (
          <TableRow
            key={o.id}
            className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
            role="link"
            tabIndex={0}
            aria-label={`Ver OC ${o.code}`}
            onClick={() => router.push(href)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                router.push(href)
              }
            }}
          >
            <TableCell>
              <span className="font-mono text-xs">{o.code}</span>
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {wsMap[o.worksiteId] ?? o.worksiteId}
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {supMap[o.supplierId] ?? o.supplierId}
            </TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <StateBadge state={o.status} entity="oc" size="sm" />
                {canRegister && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/recepcion/nueva?oc=${o.id}`}>Recibir</Link>
                  </Button>
                )}
              </div>
            </TableCell>
            <TableCell>
              {(gapMap[o.id] ?? 0) > 0
                ? <Badge variant="warning" size="sm">{gapMap[o.id]} pend. faena</Badge>
                : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {o.sentAt ? formatDate(o.sentAt) : "—"}
            </TableCell>
          </TableRow>
        )
      }}
      /* A-1: sin esto, en 390px se veían 3 de 6 columnas y "Recibir" —la acción
         principal del módulo, que se usa en faena— quedaba fuera de pantalla. */
      renderMobileCard={(row) => {
        const o = row as unknown as OrderRow
        const href = `/compras/${o.id}`
        const gap = gapMap[o.id] ?? 0
        return (
          <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={href} className="min-w-0">
                <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{o.code}</p>
                <p title={supMap[o.supplierId] ?? o.supplierId} className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                  {supMap[o.supplierId] ?? o.supplierId}
                </p>
              </Link>
              <StateBadge state={o.status} entity="oc" size="sm" />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-[var(--color-text-subtle)]">Faena</dt>
              <dd className="text-right text-[var(--color-text)]">{wsMap[o.worksiteId] ?? o.worksiteId}</dd>
              <dt className="text-[var(--color-text-subtle)]">Enviada</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{o.sentAt ? formatDate(o.sentAt) : "—"}</dd>
            </dl>
            {gap > 0 && (
              <div className="mt-2">
                <Badge variant="warning" size="sm">{gap} pend. faena</Badge>
              </div>
            )}
            {canRegister && (
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
