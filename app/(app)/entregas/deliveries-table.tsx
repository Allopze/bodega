"use client"

import { DataTable } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"

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
