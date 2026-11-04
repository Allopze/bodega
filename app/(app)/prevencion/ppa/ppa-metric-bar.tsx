import {
  ClipboardText,
  ChartLineUp,
  Timer,
} from "@phosphor-icons/react/dist/ssr"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { PPA_RATE_MIN_SAMPLE, detentionRate } from "@/lib/ppa/detention-rate"
import type { PpaStats } from "@/lib/services/ppa"
import { formatPercent } from "@/lib/utils"

function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return "—"
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} m`
}

/**
 * Tira editorial de indicadores del PPA (mismo lenguaje que el tablero
 * principal). Delega el render en `SummaryBar`; aquí solo se arma el array de
 * stats con progreso y texto secundario.
 *
 * Los conteos por estado viven en las pestañas de la lista, con su contador.
 * Aquí quedan solo los indicadores que las pestañas no representan: volumen
 * total y las dos métricas de desempeño — así ninguna cifra aparece dos veces.
 */
export function PpaMetricBar({ stats }: { stats: PpaStats }) {
  // Nunca un porcentaje pelado: con pocos PPA «27 %» son tres casos. Bajo el mínimo
  // no hay tasa («Datos insuficientes») y siempre se dice cuántos detenidos y de cuántos.
  const rate = detentionRate(stats.detenidos, stats.total)
  const basis = `${stats.detenidos} de ${stats.total} PPA ${stats.detenidos === 1 ? "detenido" : "detenidos"}`
  const detention: SummaryStat = rate.sufficient
    ? { key: "desv", label: "Tasa de detención", value: formatPercent(rate.percent, 1), icon: <ChartLineUp size={13} />, progress: rate.percent, secondary: basis }
    : stats.total === 0
      ? { key: "desv", label: "Tasa de detención", value: "Sin PPA", valueKind: "text", icon: <ChartLineUp size={13} /> }
      : {
        key: "desv", label: "Tasa de detención", value: "Datos insuficientes", valueKind: "text", icon: <ChartLineUp size={13} />,
        secondary: `${basis}; se necesitan ${PPA_RATE_MIN_SAMPLE} para una tasa`,
      }
  const cells: SummaryStat[] = [
    { key: "total", label: "Total PPA",      value: stats.total,                        icon: <ClipboardText size={13} /> },
    detention,
    { key: "resp",  label: "Resp. promedio", value: formatResponseTime(stats.avgResponseMinutes), icon: <Timer size={13} /> },
  ]

  return <SummaryBar stats={cells} />
}
