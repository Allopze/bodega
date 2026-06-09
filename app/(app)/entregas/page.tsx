import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { deliveries, deliveryItems, worksites } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { desc, inArray, or, isNull } from "drizzle-orm"
import { DeliveriesTable } from "./deliveries-table"

export const metadata: Metadata = { title: "Entregas" }

export default async function Page() {
  const session = await auth()
  if (!session) redirect("/login")

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)

  const worksiteFilter = isGlobal
    ? undefined
    : wsIds.length > 0
      ? or(inArray(deliveries.worksiteId, wsIds), isNull(deliveries.worksiteId))
      : isNull(deliveries.worksiteId)

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
    .where(worksiteFilter)
    .orderBy(desc(deliveries.deliveredAt))

  const deliveryIds = allDeliveries.map((d) => d.id)
  const worksiteIds = [...new Set(allDeliveries.map((d) => d.worksiteId).filter(Boolean))] as string[]

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

      {allDeliveries.length === 0 ? (
        <EmptyState
          icon={<Truck size={22} />}
          title="Sin entregas registradas"
          description="Registra entregas desde el módulo Bodega cuando exista stock disponible."
        />
      ) : (
        <DeliveriesTable
          deliveries={allDeliveries}
          worksiteMap={worksiteMap}
          itemCountByDelivery={itemCountByDelivery}
        />
      )}
    </>
  )
}
