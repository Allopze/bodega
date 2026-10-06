import Link from "next/link"
import { Gauge, Package, Truck } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { KpiCard } from "@/components/ui/kpi-card"
import { can } from "@/lib/auth/can"
import { getCachedAnalyticsDashboard } from "@/lib/services/read-model-cache"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel } from "../dashboard-scope"
import { ThresholdRankingChart } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { analyticsFilters } from "./shared"

// ── Bodega (incluye Entregas) ────────────────────────────────────────────────────────

export async function WarehouseSection({ session, scope }: DomainSectionsProps) {
  const analytics = await getCachedAnalyticsDashboard(session, analyticsFilters(scope))
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  /*
   * Sin entregas ni rotación en el período no hay nada que dibujar: dos tiles en
   * "0" y un gráfico vacío dejaban la vista en blanco sin decir qué hacer (A4).
   * Se reemplazan por un estado vacío con una acción real; el permiso decide a
   * cuál de las dos pantallas mandar.
   */
  if (analytics.eppDeliveries.length === 0 && analytics.productRotation.length === 0) {
    const canDeliver = can(session, "deliveries:create")
    return (
      <DomainSection
        domain={DASHBOARD_DOMAINS.bodega}
        links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
        charts={
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] xl:col-span-full">
            <EmptyState
              compact
              icon={<Package size={20} />}
              title={`Sin entregas ni movimientos en ${periodo}`}
              description="Cuando se registre una entrega de EPP o un movimiento de stock, aquí verás qué se entregó y qué productos rotan."
              action={
                <Button asChild size="sm">
                  <Link href={canDeliver ? "/entregas" : "/bodega"}>
                    {canDeliver ? "Registrar una entrega" : "Ir a Bodega"}
                  </Link>
                </Button>
              }
            />
          </div>
        }
      />
    )
  }

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.bodega}
      links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
      kpis={
        <>
          <KpiCard icon={<Truck size={16} />} label="Entregas de EPP" value={String(analytics.eppDeliveries.length)}
            detail={`Trabajadores con entrega · ${periodo}`} href="/entregas" />
          <KpiCard icon={<Gauge size={16} />} label="Productos en rotación" value={String(analytics.productRotation.length)}
            detail={`Con movimiento · ${periodo}`} href="/analitica" />
        </>
      }
      charts={
        <ThresholdRankingChart
          title="EPP entregado por trabajador" description="Unidades entregadas en el período" unit=" u."
          invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
          data={analytics.eppDeliveries.slice(0, 8).map((row) => ({
            name: row.workerName, value: row.totalQty, detail: `${row.deliveryCount} entregas · ${row.worksiteName}`,
          }))}
        />
      }
    />
  )
}
