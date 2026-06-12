import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseOrders, purchaseOrderItems, worksites, suppliers,
} from "@/db/schema"
import { inArray, desc } from "drizzle-orm"
import { requirePermission, canAny, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RecepcionTable } from "./recepcion-table"

export const metadata: Metadata = { title: "Recepción" }

export default async function RecepcionPage() {
  let session
  try { session = await requirePermission("receiving:view") }
  catch { redirect("/dashboard") }

  // OCs pending office reception or pending distribution to worksite/warehouse.
  const allOrders = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      status:      purchaseOrders.status,
      sentAt:      purchaseOrders.sentAt,
      createdAt:   purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .where(inArray(purchaseOrders.status, ["sent", "partially_office_received", "office_received", "partially_received"]))
    .orderBy(desc(purchaseOrders.sentAt))

  const visible = allOrders.filter((o) => canAccessWorksite(session, o.worksiteId))

  const wsIds       = [...new Set(visible.map((o) => o.worksiteId))]
  const supplierIds = [...new Set(visible.map((o) => o.supplierId))]
  const orderIds    = visible.map((o) => o.id)

  const [wsRows, supplierRows, itemRows] = await Promise.all([
    wsIds.length > 0
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
      : Promise.resolve([]),
    supplierIds.length > 0
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),
    orderIds.length > 0
      ? db.select({
          purchaseOrderId:        purchaseOrderItems.purchaseOrderId,
          quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
          quantityReceived:       purchaseOrderItems.quantityReceived,
        }).from(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
      : Promise.resolve([]),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))

  // Transit gap: how many items arrived at office but are still pending dispatch to faena.
  const gapMap: Record<string, number> = {}
  for (const it of itemRows) {
    if ((it.quantityOfficeReceived ?? 0) - (it.quantityReceived ?? 0) > 0) {
      gapMap[it.purchaseOrderId] = (gapMap[it.purchaseOrderId] ?? 0) + 1
    }
  }

  const canRegister = canAny(session, "receiving:register_office", "receiving:register_faena")

  return (
    <PageContainer>
      <PageHeader
        title="Recepción"
        description="Registra llegada a oficina Chome y posterior recepción en faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Recepción" },
          ]} />
        }
      />

      <RecepcionTable
        orders={visible}
        wsMap={wsMap}
        supMap={supMap}
        gapMap={gapMap}
        canRegister={canRegister}
      />
    </PageContainer>
  )
}
