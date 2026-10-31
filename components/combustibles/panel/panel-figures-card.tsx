import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Delta } from "@/components/ui/delta"
import { periodNounPlural } from "@/lib/combustibles/panel/format"
import { variationLabel, type PanelFigure, type PanelFigures, type PanelHistoryPoint } from "@/lib/combustibles/panel/figures"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { cn } from "@/lib/utils"

/**
 * Barras de los últimos períodos, cada una con su rótulo. La última (el período
 * que se está mirando) va en el verde de marca y las anteriores en su tono
 * suave; un período sin dato es una raya baja, no un cero. Sólo una escala
 * sobre el mayor valor: sirve para ver la forma, el número exacto va en el
 * texto alternativo.
 */
function PanelHistory({ points, ariaLabel }: { points: PanelHistoryPoint[]; ariaLabel: string }) {
  const max = Math.max(0, ...points.map((point) => point.value ?? 0))
  const spoken = points.map((point) => `${point.fullLabel}: ${point.display ?? "sin datos"}`).join("; ")
  return (
    <div role="img" aria-label={`${ariaLabel}. ${spoken}`} className="flex items-end gap-1.5">
      {points.map((point, index) => {
        const last = index === points.length - 1
        const height = point.value === null || max === 0 ? 3 : Math.round(4 + (point.value / max) * 34)
        return (
          <span key={`${point.label}-${index}`} aria-hidden className={cn("flex h-14 w-9 flex-col items-center justify-end gap-1 text-[11px]", last ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-subtle)]")}>
            <i
              className={cn("block w-3 rounded-t-[2px]", point.value === null ? "bg-[var(--color-border)]" : last ? "bg-[var(--color-primary)]" : "bg-[var(--color-primary-line)]")}
              style={{ height }}
            />
            {point.label}
          </span>
        )
      })}
    </div>
  )
}

function FigureRow({ figure }: { figure: PanelFigure }) {
  const { variation } = figure
  return (
    <div className="grid grid-cols-1 items-end gap-x-4 gap-y-1 border-t sm:grid-cols-[minmax(0,1fr)_auto] border-[var(--color-border)] py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <p className="text-sm text-[var(--color-text-muted)]">{figure.label}</p>
      <div className="max-sm:order-3 sm:col-start-2 sm:row-span-2 sm:row-start-1">
        <PanelHistory points={figure.history} ariaLabel={`${figure.label}, últimos ${figure.history.length} períodos`} />
      </div>
      {figure.value === null ? (
        <p className="text-lg font-semibold text-[var(--color-text-muted)]">Sin datos</p>
      ) : (
        <p className="font-mono text-[26px] font-bold leading-tight tabular-nums tracking-tight text-[var(--color-text)]">
          {figure.value}
          {figure.unitTitle ? (
            <abbr title={figure.unitTitle} className="ml-1.5 cursor-help font-sans text-sm font-medium tracking-normal text-[var(--color-text-muted)] no-underline decoration-dotted underline-offset-2 hover:underline">{figure.unit}</abbr>
          ) : (
            <span className="ml-1.5 font-sans text-sm font-medium tracking-normal text-[var(--color-text-muted)]">{figure.unit}</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs max-sm:order-4 sm:col-span-2 text-[var(--color-text-subtle)]">
        {figure.value === null ? (
          <span>{figure.emptyHint}</span>
        ) : (
          <>
            {variation ? (
              <Delta value={variation.pct} format="percent" polarity={variation.polarity} comparisonLabel={variationLabel(variation)} />
            ) : null}
            {figure.hint ? <span>{figure.hint}</span> : null}
          </>
        )}
      </div>
    </div>
  )
}

/** «El período en tres cifras»: litros cargados, kilómetros por litro de camiones y litros por hora de maquinaria. */
export function PanelFiguresCard({
  figures,
  period,
  link,
}: {
  /** `null`: la consulta falló; cada cifra dice «sin datos» y el aviso de la página explica por qué. */
  figures: PanelFigures | null
  period: ResolvedFuelPeriod
  link: (href: string) => string
}) {
  const noun = periodNounPlural(period.period.kind)
  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-h3 text-[var(--color-text)]">El período en tres cifras</h2>
        <Link href={link(FUEL_PATHS.consumo)} className="text-sm font-semibold text-[var(--color-primary-ink)] hover:underline">Ver consumo y rendimiento</Link>
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">Las barras muestran los últimos {figures ? figures.liters.history.length : 5} {noun}.</p>
      {figures ? (
        <div>
          <FigureRow figure={figures.liters} />
          <FigureRow figure={figures.trucks} />
          <FigureRow figure={figures.machinery} />
        </div>
      ) : (
        <p className="py-3 text-sm text-[var(--color-text-muted)]">No se pudieron calcular las cifras del período. Reintenta en un momento.</p>
      )}
    </Card>
  )
}
