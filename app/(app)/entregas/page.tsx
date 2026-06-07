import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { deliveries, deliveryItems, worksites } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { DataTable } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { desc, inArray } from "drizzle-orm"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Entregas" }

export default async function Page() {
  const session = await auth()
  if (!session) redirect("/login")

  const allDeliveries = await db
    .select({
      id: deliveries.id,
      code: deliveries.code,
      worksiteId: deliveries.worksiteId,
      receiverName: deliveries.receiverName,
      deliveredAt: deliveries.deliveredAt,
      notes: deliveries.notes,
    })
    .from(deliveries)
    .orderBy(desc(deliveries.deliveredAt))

  const visible = allDeliveries.filter((delivery) => {
    if (!delivery.worksiteId) return true
    return canAccessWorksite(session, delivery.worksiteId)
  })

  const deliveryIds = visible.map((d) => d.id)
  const worksiteIds = [...new Set(visible.map((d) => d.worksiteId).filter(Boolean))] as string[]

  const [itemRows, worksiteRows] = await Promise.all([
    deliveryIds.length > 0
      ? db
          .select({ deliveryId: deliveryItems.deliveryId })
          .from(deliveryItems)
          .where(inArray(deliveryItems.deliveryId, deliveryIds))
      : Promise.resolve([]),
    worksiteIds.length > 0
      ? db
          .select({ id: worksites.id, name: worksites.name })
          .from(worksites)
          .where(inArray(worksites.id, worksiteIds))
      : Promise.resolve([]),
  ])

  const itemCountByDelivery = itemRows.reduce<Record<string, number>>((acc, item) => {
    acc[item.deliveryId] = (acc[item.deliveryId] ?? 0) + 1
    return acc
  }, {})
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w.name]))

  const COLUMNS = [
    { key: "code", label: "Entrega", sortable: true, width: "w-36" },
    { key: "worksiteId", label: "Faena", sortable: true },
    { key: "receiverName", label: "Receptor", sortable: true },
    { key: "deliveredAt", label: "Fecha", sortable: true, width: "w-36" },
    { key: "items", label: "Ítems", sortable: false, width: "w-20" },
  ]

  return (
    <>
      <PageHeader
        title="Entregas"
        description="Registro de entregas a faena o trabajador."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Entregas" },
          ]} />
        }
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={<Truck size={22} />}
          title="Sin entregas registradas"
          description="Registra entregas desde el módulo Bodega cuando exista stock disponible."
        />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={visible as unknown as Record<string, unknown>[]}
          searchKeys={["code", "receiverName"]}
          pageSize={20}
          searchPlaceholder="Buscar entrega..."
          emptyTitle="Sin entregas"
          emptyDescription="No hay entregas que coincidan con la búsqueda."
          renderRow={(row) => {
            const delivery = row as unknown as typeof visible[0]
            const destination = delivery.worksiteId ? worksiteMap[delivery.worksiteId] ?? "Faena" : "Faena"

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
      )}
    </>
  )
}
