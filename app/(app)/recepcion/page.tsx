import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseOrders, worksites, suppliers,
} from "@/db/schema"
import { inArray, desc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { RecepcionTable } from "./recepcion-table"

export const metadata: Metadata = { title: "Recepción" }

export default async function RecepcionPage() {
  let session
  try { session = await requirePermission("receiving:view") }
  catch { redirect("/dashboard") }

  // OCs pending reception (sent or partially_received)
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
    .where(inArray(purchaseOrders.status, ["sent", "partially_received"]))
    .orderBy(desc(purchaseOrders.sentAt))

  const visible = allOrders.filter((o) => canAccessWorksite(session, o.worksiteId))

  const wsIds       = [...new Set(visible.map((o) => o.worksiteId))]
  const supplierIds = [...new Set(visible.map((o) => o.supplierId))]

  const [wsRows, supplierRows] = await Promise.all([
    wsIds.length > 0
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
      : Promise.resolve([]),
    supplierIds.length > 0
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))

  const canRegister = session.user.permissions.includes("receiving:register")

  return (
    <>
      <PageHeader
        title="Recepción"
        description="Marca como recibidas las órdenes de compra que llegaron a faena."
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
        canRegister={canRegister}
      />
    </>
  )
}
