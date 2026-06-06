import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseOrders, worksites, suppliers,
} from "@/db/schema"
import { inArray, desc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/admin/data-table"
import { TableRow, TableCell } from "@/components/ui/table"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { formatDate } from "@/lib/utils"

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

  const COLUMNS = [
    { key: "code",         label: "OC",         sortable: true,  width: "w-36" },
    { key: "worksiteId",   label: "Faena",      sortable: true  },
    { key: "supplierId",   label: "Proveedor",  sortable: true  },
    { key: "status",       label: "Estado",     sortable: true,  width: "w-40" },
    { key: "sentAt",       label: "Enviada",    sortable: true,  width: "w-32" },
    { key: "",             label: "",           sortable: false, width: "w-12" },
  ]

  return (
    <>
      <PageHeader
        title="Recepción"
        description="Registro de recepción de órdenes de compra."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Recepción" },
          ]} />
        }
      />

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-[var(--color-text)]">Sin OCs pendientes de recepción</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Las órdenes de compra enviadas aparecerán aquí cuando estén listas para recibir.
          </p>
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={visible as unknown as Record<string, unknown>[]}
          searchKeys={["code"]}
          pageSize={20}
          searchPlaceholder="Buscar OC..."
          emptyTitle="Sin OCs pendientes"
          emptyDescription="Las OCs enviadas al proveedor aparecerán aquí."
          renderRow={(row) => {
            const o = row as unknown as typeof visible[0]
            return (
              <TableRow key={o.id} className="group">
                <TableCell>
                  <span className="font-mono text-xs">{o.code}</span>
                </TableCell>
                <TableCell className="text-sm text-[var(--color-text-muted)]">
                  {wsMap[o.worksiteId] ?? o.worksiteId}
                </TableCell>
                <TableCell className="text-sm text-[var(--color-text-muted)]">
                  {supMap[o.supplierId] ?? o.supplierId}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <StateBadge state={o.status} entity="oc" size="sm" />
                    {canRegister && (
                      <Button variant="secondary" size="sm" asChild>
                        <Link href={`/recepcion/nueva?oc=${o.id}`}>Recibir</Link>
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-[var(--color-text-subtle)]">
                  {o.sentAt ? formatDate(o.sentAt) : "—"}
                </TableCell>
                <TableCell className="text-right pr-3">
                  <Link
                    href={`/compras/${o.id}`}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] opacity-0 group-hover:opacity-100"
                    aria-label={`Ver OC ${o.code}`}
                  >
                    <ArrowRight size={14} />
                  </Link>
                </TableCell>
              </TableRow>
            )
          }}
        />
      )}
    </>
  )
}
