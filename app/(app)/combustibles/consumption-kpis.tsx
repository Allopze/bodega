import { formatCLP, formatQty } from "@/lib/utils"
import type { ConsumptionDashboardData } from "@/lib/combustibles/consumption-dashboard"

/**
 * Cifras de apoyo del análisis de tarjetas, en una línea de texto (A1: no son
 * tiles). Las que antes eran cuatro tarjetas arriba de «Consumo» se movieron
 * adonde se decide: el total consumido y las transacciones están en «De dónde
 * vino lo cargado», el monto en «Pagos» y las patentes sin vincular en «Por
 * revisar».
 */
export function ConsumptionAnalysisMetrics({ kpis, canViewCosts }: { kpis: ConsumptionDashboardData["kpis"]; canViewCosts: boolean }) {
  // `toFixed` rinde el punto decimal inglés en una interfaz que en todas las
  // demás cifras usa coma (es-CL).
  const rendimiento = kpis.rendimientoPromedioPonderado > 0
    ? kpis.rendimientoPromedioPonderado.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—"
  const precio = kpis.precioPromedioUnidad != null ? `${formatCLP(kpis.precioPromedioUnidad)}/L` : "—"

  return (
    <dl className="mb-7 flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--color-border)] py-3 text-sm">
      {canViewCosts && <div className="flex items-baseline gap-2">
        <dt className="text-[var(--color-text-muted)]">Precio promedio</dt>
        <dd className="font-mono font-semibold tabular-nums">{precio}</dd>
      </div>}
      <div className="flex items-baseline gap-2">
        <dt className="text-[var(--color-text-muted)]">Patentes con consumo</dt>
        <dd className="font-mono font-semibold tabular-nums">{formatQty(kpis.patentesUnicas)}</dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="text-[var(--color-text-muted)]" title="Promedio ponderado por cantidad consumida, con el rendimiento que informan las tarjetas">Rendimiento promedio</dt>
        <dd className="font-mono font-semibold tabular-nums">{rendimiento}</dd>
      </div>
    </dl>
  )
}
