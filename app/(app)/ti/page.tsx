import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { itAssets, itTickets } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCLP } from "@/lib/utils"
import { Laptop, UserCirclePlus, Wrench, ShieldCheck, Ticket, Key } from "@phosphor-icons/react/dist/ssr"
import {
  getTiDashboardCounts, getAssetsByType, getAssetsByWorksite, getAssetsByStatus,
  getMaintenanceCostByMonth, getAssetsByAge,
} from "@/lib/services/ti/queries"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import { TiCharts } from "./ti-charts"

export const metadata: Metadata = { title: "TI" }

export default async function TiDashboardPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const assetScope = worksiteScopeSql(session, itAssets.worksiteId)
  const ticketScope = worksiteScopeSql(session, itTickets.worksiteId)
  const serviceScope = serviceWorksiteScope(session)

  const [
    counts,
    byType,
    byWorksite,
    byStatus,
    maintenanceByMonth,
    byAge,
  ] = await Promise.all([
    getTiDashboardCounts(assetScope, ticketScope, serviceScope),
    getAssetsByType(assetScope),
    getAssetsByWorksite(assetScope),
    getAssetsByStatus(assetScope),
    getMaintenanceCostByMonth(assetScope),
    getAssetsByAge(assetScope),
  ])

  // Regla A5: cada cifra aparece UNA sola vez en la pantalla. Los cuatro tiles
  // se quedan con activos, custodia, reparación y garantías; esta tira cubre
  // solo lo que no está arriba.
  const summaryStats: SummaryStat[] = [
    { key: "retired", label: "Activos dados de baja", value: String(counts.retired), href: "/ti/activos?estado=dado_de_baja" },
    { key: "open", label: "Tickets abiertos", value: String(counts.openTickets), href: "/ti/tickets" },
    { key: "critical", label: "Tickets críticos", value: String(counts.criticalTickets), href: "/ti/tickets?prioridad=critica", tone: counts.criticalTickets > 0 ? "signal" : undefined },
    { key: "lic14", label: "Licencias por renovar (14 días)", value: String(counts.licensesRenewing14), href: "/ti/licencias" },
    { key: "cost", label: "Gasto reparación (12 meses)", value: formatCLP(counts.maintenanceCostYear), href: "/ti/mantenciones" },
  ]

  const statusChart = byStatus.map((row) => ({
    name: IT_ASSET_STATUS_META[row.status]?.label ?? row.status,
    total: row.total,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="TI"
        description="Gestión de activos tecnológicos, custodia, soporte y servicios de CHOME."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI" }]} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<Laptop size={16} />}
          label="Activos"
          value={String(counts.totalAssets)}
          detail={`${counts.assigned} asignados · ${counts.available} disponibles`}
          href="/ti/activos"
        />
        <KpiCard
          icon={<UserCirclePlus size={16} />}
          label="En custodia"
          value={String(counts.activeAssignments)}
          detail="Equipos entregados con acta vigente"
          href="/ti/asignaciones"
        />
        <KpiCard
          icon={<Wrench size={16} />}
          label="En reparación"
          value={String(counts.inRepair)}
          tone={counts.inRepair > 0 ? "signal" : "neutral"}
          detail="Equipos fuera de servicio hoy"
          href="/ti/activos?estado=en_reparacion"
        />
        <KpiCard
          icon={<ShieldCheck size={16} />}
          label="Garantías por vencer"
          value={String(counts.warrantiesExpiring30)}
          tone={counts.warrantiesExpiring30 > 0 ? "danger" : "neutral"}
          detail={`${counts.warrantiesExpiring60} a 60 días · ${counts.warrantiesExpiring90} a 90 días`}
          href="/ti/garantias?ventana=expiring_30"
        />
      </div>

      <div className="mt-3">
        <SummaryBar stats={summaryStats} />
      </div>

      {counts.totalAssets === 0 && counts.openTickets === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Aún no hay activos TI registrados"
            description="Registra el primer activo del inventario para empezar a gestionar custodia, garantías y mantenciones."
            action={<Link href="/ti/activos" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline"><Laptop size={14} /> Ir al inventario</Link>}
          />
        </div>
      ) : (
        <TiCharts
          byType={byType}
          byWorksite={byWorksite}
          byStatus={statusChart}
          maintenanceByMonth={maintenanceByMonth}
          byAge={byAge}
        />
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link href="/ti/tickets" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs transition-colors hover:bg-[var(--color-surface-2)]">
          <div className="flex items-center gap-2">
            <Ticket size={16} className="text-[var(--color-text-subtle)]" />
            <h2 className="text-sm font-medium text-[var(--color-text)]">Mesa de ayuda</h2>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Hardware, software, correo, accesos e impresoras. Registra y sigue los casos de tus faenas.
          </p>
        </Link>
        <Link href="/ti/licencias" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs transition-colors hover:bg-[var(--color-surface-2)]">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-[var(--color-text-subtle)]" />
            <h2 className="text-sm font-medium text-[var(--color-text)]">Licencias y servicios</h2>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Contratos, cupos asignados y fechas de renovación de las suscripciones de la empresa.
          </p>
        </Link>
      </div>
    </PageContainer>
  )
}
