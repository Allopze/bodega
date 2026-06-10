"use client"

import { DataTable } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { Truck } from "@phosphor-icons/react"

interface DeliveryRow {
  id:           string
  code:         string
  worksiteId:   string | null
  receiverName: string | null
  deliveredAt:  string
  notes:        string | null
}

interface DeliveriesTableProps {
  deliveries: DeliveryRow[]
  worksiteMap: Record<string, string>
  itemCountByDelivery: Record<string, number>
}

const COLUMNS = [
  { key: "code", label: "Entrega", sortable: true, width: "w-36" },
  { key: "worksiteId", label: "Faena", sortable: true },
  { key: "receiverName", label: "Receptor", sortable: true },
  { key: "deliveredAt", label: "Fecha", sortable: true, width: "w-36" },
  { key: "items", label: "Ítems", sortable: false, width: "w-20" },
]

export function DeliveriesTable({
  deliveries,
  worksiteMap,
  itemCountByDelivery,
}: DeliveriesTableProps) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={deliveries as unknown as Record<string, unknown>[]}
      searchKeys={["code", "receiverName"]}
      pageSize={20}
      searchPlaceholder="Buscar entrega..."
      emptyTitle="Sin entregas"
      emptyDescription="No hay entregas que coincidan con la búsqueda."
      renderMobileCard={(row) => {
        const delivery = row as unknown as DeliveryRow
        const destination = delivery.worksiteId
          ? worksiteMap[delivery.worksiteId] ?? "Faena"
          : "Faena"

        return (
          <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <Truck size={18} className="text-[var(--color-text-subtle)] shrink-0" />
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">{delivery.code}</p>
                  <p className="mt-0.5 text-sm font-medium text-[var(--color-text)] truncate">{destination}</p>
                </div>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--color-text-subtle)]">Receptor</dt>
                <dd className="text-[var(--color-text-muted)] truncate">{delivery.receiverName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-subtle)]">Ítems</dt>
                <dd className="font-mono tabular-nums text-[var(--color-text)]">{itemCountByDelivery[delivery.id] ?? 0}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[var(--color-text-subtle)]">Fecha</dt>
                <dd className="text-[var(--color-text-muted)]">{formatDate(delivery.deliveredAt)}</dd>
              </div>
            </dl>
          </article>
        )
      }}
      renderRow={(row) => {
        const delivery = row as unknown as DeliveryRow
        const destination = delivery.worksiteId
          ? worksiteMap[delivery.worksiteId] ?? "Faena"
          : "Faena"

        return (
          <TableRow key={delivery.id}>
            <TableCell>
              <span className="font-mono text-xs">{delivery.code}</span>
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {destination}
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {delivery.receiverName ?? "—"}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {formatDate(delivery.deliveredAt)}
            </TableCell>
            <TableCell className="font-mono text-sm text-[var(--color-text)]">
              {itemCountByDelivery[delivery.id] ?? 0}
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
