import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, suppliers, worksites } from "@/db/schema"
import { eq, asc, and } from "drizzle-orm"
import { formatCLP } from "@/lib/utils"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge } from "@/components/states/state-badge"
import { listMaintenances, maintenanceCostByAsset } from "@/lib/services/ti/maintenance"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { MaintenanceTable } from "./maintenance-table"
import { MaintenanceCta } from "./maintenance-sheet"
import { MaintenanceFilters } from "./maintenance-filters"
import { IT_MAINTENANCE_TYPES } from "@/lib/validation/ti"

export const metadata: Metadata = { title: "Mantenciones" }

/** Fracción del costo de compra a partir de la cual se sugiere evaluar el reemplazo del equipo. */
const REPLACEMENT_RATIO = 0.5

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")

export default async function MantencionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_maintenance")
  const sp = await searchParams
  const tipo = typeof sp.tipo === "string" && (IT_MAINTENANCE_TYPES as readonly string[]).includes(sp.tipo) ? sp.tipo : ""
  const faena = typeof sp.faena === "string" ? sp.faena : ""
  const desde = isoDate(sp.desde)
  const hasta = isoDate(sp.hasta)
  // La faena pedida se intersecta con el alcance del usuario: una faena ajena da vacío.
  const scope = worksiteScopeSql(session, itAssets.worksiteId, faena || undefined)
  const optionScope = worksiteScopeSql(session, itAssets.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const [rows, suppliersList, assetOptions, costRanking, worksitesList] = await Promise.all([
    listMaintenances({ scope, type: tipo || undefined, from: desde || undefined, to: hasta || undefined }),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    listAssetOptions(optionScope),
    maintenanceCostByAsset(scope),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
  ])

  // Un gasto de $300.000 es poco en un servidor y mucho en un notebook de
  // $400.000. Se compara contra el costo del equipo: primero los que más
  // gastaron en proporción a lo que valen; los que no tienen costo registrado
  // no se pueden comparar y quedan después, por gasto absoluto.
  const ranking = costRanking
    .map((row) => ({ ...row, ratio: row.assetCost && row.assetCost > 0 ? row.totalCost / row.assetCost : null }))
    .sort((a, b) => {
      if (a.ratio !== null && b.ratio !== null) return b.ratio - a.ratio
      if (a.ratio !== null) return -1
      if (b.ratio !== null) return 1
      return b.totalCost - a.totalCost
    })

  return (
    <PageContainer>
      <PageHeader
        title="Mantenciones"
        description="Mantenciones y reparaciones por equipo, con su costo acumulado para identificar activos que conviene reemplazar."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Mantenciones" }]} />}
        actions={canManage ? (
          <MaintenanceCta suppliers={suppliersList} assets={assetOptions} />
        ) : undefined}
      />

      <MaintenanceFilters current={{ tipo, faena, desde, hasta }} worksites={worksitesList} />

      <MaintenanceTable rows={rows} canManage={canManage} suppliers={suppliersList} />

      <section className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
        <h2 className="text-h2">Candidatos a reemplazo</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          Se ordena por lo que se ha gastado en reparar cada equipo como porcentaje de su costo de compra; con {Math.round(REPLACEMENT_RATIO * 100)} % o más conviene evaluar reemplazarlo. Los equipos sin costo de compra registrado van al final, por gasto total. No cuenta mantenciones anuladas.
        </p>
        {ranking.length === 0 ? (
          <EmptyState
            compact
            align="start"
            title="Sin mantenciones registradas"
            description={canManage ? "Registra una mantención para construir el ranking de costos." : "El ranking aparecerá cuando existan intervenciones técnicas."}
          />
        ) : (
          <ul className="mt-3 space-y-1">
            {ranking.slice(0, 10).map((row) => (
              <li key={row.assetId} className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-2 text-sm last:border-b-0">
                <span className="text-[var(--color-text)]">
                  <Link href={`/ti/activos/${row.assetId}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">{row.assetCode}</Link>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">{[row.brand, row.model].filter(Boolean).join(" ")}</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2 text-right">
                  {row.ratio !== null ? (
                    <MetaBadge
                      meta={{
                        label: `${Math.round(row.ratio * 100)} % del valor`,
                        variant: row.ratio >= REPLACEMENT_RATIO ? "warning" : "default",
                      }}
                    />
                  ) : (
                    <span className="text-xs text-[var(--color-text-subtle)]">Sin costo de compra</span>
                  )}
                  <span className="font-mono text-xs font-semibold tabular-nums text-[var(--color-text)]">
                    {formatCLP(row.totalCost)}
                    {row.assetCost ? ` de ${formatCLP(row.assetCost)}` : ""} · {row.count} {row.count === 1 ? "mantención" : "mantenciones"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
