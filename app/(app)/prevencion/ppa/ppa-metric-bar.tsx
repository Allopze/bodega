import {
  ClipboardText,
  ChartLineUp,
  Timer,
} from "@phosphor-icons/react/dist/ssr"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { detentionFigure } from "@/lib/ppa/detention-rate"
import type { PpaStats } from "@/lib/services/ppa"

function formatResponseTime(minutes: number): string {
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
  // Nunca un porcentaje pelado: con pocos PPA «27 %» son tres casos. Bajo el mínimo no
  // hay porcentaje: el tile dice el conteo («3 de 11 PPA detenidos») y que la base es
  // demasiado chica (n = 11). La misma regla del tablero (`detentionFigure`).
  const figure = detentionFigure(stats.detenidos, stats.total)
  const detention: SummaryStat = figure.kind === "rate"
    ? { key: "desv", label: "Tasa de detención", value: figure.value, icon: <ChartLineUp size={13} />, progress: figure.percent, secondary: figure.basis }
    : figure.kind === "empty"
      ? { key: "desv", label: "Tasa de detención", value: "Sin PPA", valueKind: "text", icon: <ChartLineUp size={13} /> }
      : { key: "desv", label: "Tasa de detención", value: figure.basis, valueKind: "text", icon: <ChartLineUp size={13} />, secondary: figure.note }
  // Sin ningún PPA revisado no hay promedio: palabra en sans, no un «—» con estilo de cifra.
  const response: SummaryStat = stats.avgResponseMinutes === null
    ? { key: "resp", label: "Resp. promedio", value: "Sin respuestas aún", valueKind: "text", icon: <Timer size={13} /> }
    : { key: "resp", label: "Resp. promedio", value: formatResponseTime(stats.avgResponseMinutes), icon: <Timer size={13} /> }
  const cells: SummaryStat[] = [
    { key: "total", label: "Total PPA",      value: stats.total,                        icon: <ClipboardText size={13} /> },
    detention,
    response,
  ]

  return <SummaryBar stats={cells} />
}
