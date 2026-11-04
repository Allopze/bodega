import { Delta } from "@/components/ui/delta"
import { cn, formatQty } from "@/lib/utils"
import type { DurationStat, LeadTimeGroup } from "@/lib/services/analytics-module/lead-time-shape"

/**
 * Plazos por tramo de un proceso (solicitud → aprobación → OC → llegada → entrega): una barra
 * horizontal apilada por grupo (todas las faenas, cada faena), un segmento por tramo con el largo de
 * su **mediana** en días y una marca vertical en el **P90** del plazo total (CHART-029).
 *
 * Reglas de honestidad que el componente impone, porque un plazo mal leído lleva a reclamarle al
 * área equivocada:
 *
 * - **Nunca un número pelado.** Toda cifra va con su `n` al lado. Un tramo o un grupo con muestra
 *   insuficiente no dibuja segmento ni cifra: dice «datos insuficientes» y cuántos ítems hay.
 * - **La barra es la suma de las medianas de cada tramo**, y eso no es la mediana del total (la
 *   mediana de una suma no es la suma de las medianas). El total, medido ítem por ítem, va escrito
 *   arriba de cada barra; la nota al pie lo dice.
 * - **El color nunca carga solo el significado:** cada tramo lleva su nombre y su cifra. Los tramos son
 *   etapas de un ciclo, así que usan una rampa de un solo matiz, de clara a oscura, en el orden del
 *   proceso (la misma lógica que las etapas de `/seguimiento`); dos tramos vecinos nunca comparten tono.
 * - **Sólo ítems cerrados.** Lo que sigue esperando no tiene plazo todavía, así que los plazos reales
 *   pueden ser mayores que los que se ven: sesgo de supervivencia que la pantalla declara.
 *
 * Server-safe: sin hooks; las barras son CSS.
 */

/** Días corridos, con un decimal si hace falta: «1 día», «6,5 días». */
export function formatLeadDays(value: number): string {
  return `${formatQty(value, undefined, { maximumFractionDigits: 1 })} ${value === 1 ? "día" : "días"}`
}

/**
 * Relleno del tramo `index` de `total`: de 35 % a 100 % de `chart-2` sobre la superficie, en
 * OKLab (en OKLCH el matiz gira hacia el rosa). Función aparte porque jsdom descarta `color-mix`
 * de los estilos en línea y la prueba lee el valor, no el elemento.
 */
export function stageFill(index: number, total: number): string {
  const share = total <= 1 ? 100 : Math.round(35 + (65 * index) / (total - 1))
  return share === 100 ? "var(--color-chart-2)" : `color-mix(in oklab, var(--color-chart-2) ${share}%, var(--color-surface))`
}

/** «Mediana 9 días · n = 24 · P90 21 días», o «Datos insuficientes · n = 3». Nunca la cifra sola. */
export function durationLabel(stat: DurationStat): string {
  if (stat.median === null) return `Datos insuficientes · n = ${stat.n}`
  const p90 = stat.p90 === null ? "" : ` · P90 ${formatLeadDays(stat.p90)}`
  return `Mediana ${formatLeadDays(stat.median)} · n = ${stat.n}${p90}`
}

const sumOfMedians = (group: LeadTimeGroup) => group.stages.reduce((sum, stage) => sum + (stage.median ?? 0), 0)

export function StageDurationBar({
  groups,
  previousTotal,
  ariaLabel,
  className,
}: {
  groups: LeadTimeGroup[]
  /** Total del período anterior, para la variación del primer grupo (el total de todas las faenas). */
  previousTotal?: DurationStat
  /** Nombre accesible de la lista (p. ej. «Plazos del ciclo de abastecimiento por faena»). */
  ariaLabel: string
  className?: string
}) {
  // Todas las barras miden contra la misma escala: un grupo más lento se ve más largo.
  const scale = Math.max(1, ...groups.flatMap((group) => [sumOfMedians(group), group.total.p90 ?? 0]))
  const stageCount = groups[0]?.stages.length ?? 0

  return (
    <div className={cn("min-w-0", className)}>
      <ul aria-label={ariaLabel} className="grid gap-5">
        {groups.map((group, groupIndex) => {
          const comparable = groupIndex === 0 && previousTotal && !previousTotal.insufficient && !group.total.insufficient
            && (previousTotal.median ?? 0) > 0
          const change = comparable ? Math.round((((group.total.median ?? 0) - (previousTotal.median ?? 0)) / (previousTotal.median ?? 1)) * 1000) / 10 : null
          const p90 = group.total.p90
          return (
            <li key={group.key} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="truncate text-sm font-medium text-[var(--color-text)]" title={group.label}>{group.label}</span>
                <span className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-[var(--color-text-muted)]">
                  <span>{durationLabel(group.total)}</span>
                  {change !== null && (
                    <Delta value={change} format="percent" polarity="up-bad" comparisonLabel={`vs. período anterior (n = ${previousTotal!.n})`} />
                  )}
                </span>
              </div>

              <div className="relative mt-1.5">
                <div aria-hidden className="flex h-3 gap-px overflow-hidden rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border)]">
                  {group.stages.map((stage, index) => (stage.median !== null && stage.median > 0
                    ? (
                      <div
                        key={stage.key}
                        data-stage={stage.key}
                        title={`${stage.label}: ${formatLeadDays(stage.median)} (n = ${stage.n})`}
                        className="h-full shrink"
                        style={{ width: `${(stage.median / scale) * 100}%`, background: stageFill(index, stageCount) }}
                      />
                    )
                    : null))}
                </div>
                {p90 !== null && (
                  <span
                    aria-hidden
                    data-p90=""
                    title={`P90 del plazo total: ${formatLeadDays(p90)} (n = ${group.total.n})`}
                    className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--color-text)]"
                    style={{ left: `${Math.min(100, (p90 / scale) * 100)}%` }}
                  />
                )}
              </div>

              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {group.stages.map((stage, index) => (
                  <li key={stage.key} className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: stageFill(index, stageCount) }} />
                    <span>{stage.label}</span>
                    {stage.median === null ? (
                      <span className="tabular-nums">datos insuficientes (n = {stage.n})</span>
                    ) : (
                      <span className="font-semibold tabular-nums text-[var(--color-text)]">
                        {formatLeadDays(stage.median)}
                        <span className="font-normal text-[var(--color-text-muted)]"> (n = {stage.n})</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-xs text-[var(--color-text-muted)] text-pretty">
        La barra suma la mediana de cada tramo; la marca vertical es el P90 del plazo total, y la mediana total se mide ítem por ítem, así que no es la suma de los tramos.
      </p>
    </div>
  )
}
