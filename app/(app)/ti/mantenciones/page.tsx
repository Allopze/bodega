import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, suppliers } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { formatCLP } from "@/lib/utils"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { listMaintenances, maintenanceCostByAsset } from "@/lib/services/ti/maintenance"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { MaintenanceTable } from "./maintenance-table"
import { MaintenanceSheet } from "./maintenance-sheet"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Mantenciones TI" }

export default async function MantencionesPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_maintenance")
  const scope = worksiteScopeSql(session, itAssets.worksiteId)

  const [rows, suppliersList, assetOptions, costRanking] = await Promise.all([
    listMaintenances({ scope }),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    listAssetOptions(scope),
    maintenanceCostByAsset(scope),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Mantenciones y reparaciones"
        description="Intervenciones técnicas por equipo, con costo acumulado para identificar activos que conviene reemplazar."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Mantenciones" }]} />}
        actions={canManage ? (
          <MaintenanceSheet
            trigger={<Button><Plus size={14} className="mr-1.5" /> Registrar mantención</Button>}
            suppliers={suppliersList}
            assets={assetOptions}
          />
        ) : undefined}
      />

      <MaintenanceTable rows={rows} canManage={canManage} suppliers={suppliersList} />

      <section className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
        <h2 className="text-h2">Mayor gasto acumulado por equipo</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Los primeros de la lista son candidatos a reemplazo.</p>
        {costRanking.length === 0 ? (
          <EmptyState
            compact
            align="start"
            title="Sin mantenciones registradas"
            description={canManage ? "Registra una mantención para construir el ranking de costos." : "El ranking aparecerá cuando existan intervenciones técnicas."}
          />
        ) : (
          <ul className="mt-3 space-y-1">
            {costRanking.slice(0, 10).map((row) => (
              <li key={row.assetId} className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0">
                <span className="text-[var(--color-text)]">
                  <Link href={`/ti/activos/${row.assetId}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">{row.assetCode}</Link>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">{[row.brand, row.model].filter(Boolean).join(" ")}</span>
                </span>
                <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
                  {formatCLP(row.totalCost)} · {row.count} {row.count === 1 ? "mantención" : "mantenciones"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
