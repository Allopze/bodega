import {
  ClipboardText,
  ChartLineUp,
  Timer,
} from "@phosphor-icons/react/dist/ssr"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import type { PpaStats } from "@/lib/services/ppa"

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
  const cells: SummaryStat[] = [
    { key: "total", label: "Total PPA",      value: stats.total,                        icon: <ClipboardText size={13} /> },
    { key: "desv",  label: "% desviaciones", value: `${stats.porcentajeDesviaciones}%`, icon: <ChartLineUp size={13} />, progress: stats.porcentajeDesviaciones },
    { key: "resp",  label: "Resp. promedio", value: formatResponseTime(stats.avgResponseMinutes), icon: <Timer size={13} /> },
  ]

  return <SummaryBar stats={cells} />
}
