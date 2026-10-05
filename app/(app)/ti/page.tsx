import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { itAssets, itTickets } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { KpiCard } from "@/components/ui/kpi-card"
import { EmptyState } from "@/components/ui/empty-state"
import { todayInChile } from "@/lib/utils"
import { ArrowRight, CheckCircle, Laptop, Package, Ticket, UserCirclePlus } from "@phosphor-icons/react/dist/ssr"
import {
  getTiDashboardCounts, getAssetsByWorksiteGroup, getMaintenanceCostByMonth, getTiAttentionItems,
} from "@/lib/services/ti/queries"
import { fillMaintenanceMonths } from "@/lib/services/ti/dashboard"
import { TiCharts } from "./ti-charts"

export const metadata: Metadata = { title: "Resumen" }

export default async function TiDashboardPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const assetScope = worksiteScopeSql(session, itAssets.worksiteId)
  const serviceScope = serviceWorksiteScope(session)

  const [counts, attention, byWorksite, maintenanceRows] = await Promise.all([
    getTiDashboardCounts(assetScope, worksiteScopeSql(session, itTickets.worksiteId), serviceScope),
    getTiAttentionItems(serviceScope),
    getAssetsByWorksiteGroup(assetScope),
    getMaintenanceCostByMonth(assetScope),
  ])
  const maintenanceByMonth = fillMaintenanceMonths(maintenanceRows, todayInChile())

  return (
    <PageContainer>
      <PageHeader
        title="Resumen"
        description="Qué hay que atender hoy y cómo está el parque tecnológico."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI" }, { label: "Resumen" }]} />}
      />

      {counts.totalAssets === 0 && counts.openTickets === 0 ? (
        <EmptyState
          title="Aún no hay activos TI registrados"
          description="Registra el primer activo del inventario para empezar a gestionar custodia, garantías y mantenciones."
          action={<Link href="/ti/activos" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline"><Laptop size={14} /> Ir al inventario</Link>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-labelledby="ti-atencion" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs">
            <h2 id="ti-atencion" className="px-5 pt-5 text-sm font-semibold text-[var(--color-text)]">Atención hoy</h2>
            {attention.length === 0 ? (
              <EmptyState
                compact
                tone="success"
                icon={<CheckCircle size={20} />}
                title="Todo al día"
                description="No hay actas sin acuse, préstamos vencidos, tickets fuera de plazo ni vencimientos próximos en tus faenas. Cuando algo requiera atención, aparecerá aquí."
                action={<Link href="/ti/tickets" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline">Ir a la mesa de ayuda</Link>}
              />
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)] pb-2">
                {attention.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]"
                    >
                      <span className="min-w-8 text-right text-lg font-semibold tabular-nums text-[var(--color-signal-ink)]">
                        {item.total}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--color-text)]">{item.label}</span>
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">
                          {item.byWorksite.length > 0
                            ? item.byWorksite.map((w) => `${w.name} ${w.total}`).join(" · ")
                            : item.hint}
                        </span>
                      </span>
                      <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--color-text-subtle)] transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={<Laptop size={16} />}
              label="Parque vigente"
              value={String(counts.totalAssets)}
              detail="Equipos que la empresa opera hoy"
              href="/ti/activos"
            />
            <KpiCard
              icon={<UserCirclePlus size={16} />}
              label="En custodia"
              value={String(counts.activeAssignments)}
              detail="Equipos entregados con acta vigente"
              href="/ti/asignaciones?estado=vigentes"
            />
            <KpiCard
              icon={<Package size={16} />}
              label="Disponibles"
              value={String(counts.available)}
              detail="Listos para entregar"
              href="/ti/activos?estado=disponible"
            />
            <KpiCard
              icon={<Ticket size={16} />}
              label="Tickets abiertos"
              value={String(counts.openTickets)}
              detail="Casos de la mesa de ayuda sin cerrar"
              href="/ti/tickets"
            />
          </div>

          <TiCharts byWorksite={byWorksite} maintenanceByMonth={maintenanceByMonth} />
        </div>
      )}
    </PageContainer>
  )
}
