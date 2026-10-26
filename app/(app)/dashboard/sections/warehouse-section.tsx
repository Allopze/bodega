import Link from "next/link"
import { formatQty } from "@/lib/utils"
import { Gauge, Package, Truck } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { can } from "@/lib/auth/can"
import { getCachedAnalyticsDashboard } from "@/lib/services/read-model-cache"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel } from "../dashboard-scope"
import { ChartFrame } from "../charts/chart-frame"

import type { DomainSectionsProps } from "./shared"
import { analyticsFilters } from "./shared"

// ── Bodega (incluye Entregas) ────────────────────────────────────────────────────────

export async function WarehouseSection({ session, scope }: DomainSectionsProps) {
  const analytics = await getCachedAnalyticsDashboard(session, analyticsFilters(scope))
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")
  // El permiso decide a qué pantalla mandar: registrar una entrega o sólo mirar.
  const canDeliver = can(session, "deliveries:create")

  /*
   * Sin entregas ni rotación en el período no hay nada que dibujar: dos tiles en
   * "0" y un gráfico vacío dejaban la vista en blanco sin decir qué hacer (A4).
   * Se reemplazan por un estado vacío con una acción real; el permiso decide a
   * cuál de las dos pantallas mandar.
   */
  if (analytics.eppDeliveries.length === 0 && analytics.productRotation.length === 0) {
    return (
      <DomainSection
        domain={DASHBOARD_DOMAINS.bodega}
        links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
        charts={
          // Fila completa del panel: la superficie y el borde los pone el panel, no
          // una tarjeta propia (antes `rounded-2xl border` dentro del marco).
          <ChartSlot span="full">
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
          </ChartSlot>
        }
      />
    )
  }

  // Con una sola de las dos mitades vacía, su tile dice qué falta y a dónde ir
  // en vez de mostrar un "0" pelado (A1/A4). La puerta para llenar cada una es
  // distinta: las entregas se registran en /entregas y el stock se mueve en /bodega.
  const noDeliveries = analytics.eppDeliveries.length === 0
  // Trabajadores distintos del período. `eppDeliveries.length` contaba filas
  // trabajador × producto de un top 10: nunca pasaba de 10 ni eran trabajadores.
  const eppWorkers = analytics.eppWorkerCount ?? analytics.eppDeliveries.length
  const noRotation = analytics.productRotation.length === 0

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.bodega}
      links={[{ label: "Bodega", href: "/bodega" }, { label: "Entregas", href: "/entregas" }]}
      kpis={
        <>
          <KpiCard {...DASHBOARD_KPI} icon={<Truck size={16} />} label="Entregas de EPP" value={formatQty(eppWorkers)}
            detail={`Trabajadores con entrega · ${periodo}`} href="/entregas"
            empty={noDeliveries ? { message: `Sin entregas de EPP en ${periodo}`, actionLabel: canDeliver ? "Registrar una entrega" : "Ver entregas" } : undefined} />
          <KpiCard {...DASHBOARD_KPI} icon={<Gauge size={16} />} label="Productos en rotación" value={String(analytics.productRotation.length)}
            detail={`Con movimiento · ${periodo}`} href={noRotation ? "/bodega" : "/analitica"}
            empty={noRotation ? { message: `Sin movimientos de stock en ${periodo}`, actionLabel: "Ir a Bodega" } : undefined} />
        </>
      }
      charts={
        // Sin entregas no hay ranking que dibujar: la celda no se monta y el
        // panel no reserva un marco vacío.
        !noDeliveries && (
          // Fila completa: es la única celda del panel y una de 1 o 2 columnas
          // dejaba el resto de la grilla en blanco.
          <ChartSlot span="full">
            <ChartFrame title="EPP entregado por trabajador" description="Unidades entregadas en el período">
              {/* Se pasan todos los trabajadores y se muestran 8: el % del total
                  se calcula sobre el universo, no sobre el recorte. */}
              <RankedList
                items={analytics.eppDeliveries.map((row) => ({
                  // El servicio agrupa por trabajador **y producto**: sin el producto en la
                  // clave dos filas de la misma persona colisionarían, y sin él en el
                  // detalle no se sabría por qué aparece dos veces.
                  key: `${row.productId}:${row.workerName}:${row.worksiteName}`, label: row.workerName, value: row.totalQty,
                  detail: `${row.productName} · ${row.deliveryCount} ${row.deliveryCount === 1 ? "entrega" : "entregas"} · ${row.worksiteName}`,
                }))}
                format="count" unit=" u." mode="share" moreHref="/entregas"
                ariaLabel="EPP entregado por trabajador, en unidades"
              />
            </ChartFrame>
          </ChartSlot>
        )
      }
    />
  )
}
