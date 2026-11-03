import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"
import { RISK_BAND_FILL } from "./risk-bands"

/**
 * Barra apilada al 100 % de las cuatro clasificaciones del RE-04 (CHART-007,
 * portafolio de la MIPER): de qué está hecho el riesgo de una faena, de
 * Tolerable a Intolerable, de izquierda a derecha.
 *
 * Lo que la barra dibuja es la **proporción**; la cifra exacta de cada banda va
 * en una lista debajo, con su rótulo para el lector de pantalla. Por eso la barra
 * es decorativa (`aria-hidden`) y el color no es la única señal. Una faena sin
 * riesgos evaluados no recibe una barra vacía: se dice.
 */
export function RiskShareBar({ label, counts, className }: {
  /** Nombra el grupo para el lector de pantalla («Faena Teno»). */
  label: string
  counts: Record<RiskClassification, number>
  className?: string
}) {
  const present = RISK_CLASSIFICATIONS.filter((classification) => counts[classification] > 0)
  if (present.length === 0) return <p className={cn("text-xs text-[var(--color-text-subtle)]", className)}>Sin riesgos evaluados</p>
  return (
    <div className={cn("min-w-36", className)}>
      <div aria-hidden="true" className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {present.map((classification) => (
          <span
            key={classification}
            data-band={classification}
            className="min-w-1 basis-0 first:rounded-l-full last:rounded-r-full"
            style={{ flexGrow: counts[classification], backgroundColor: RISK_BAND_FILL[classification] }}
          />
        ))}
      </div>
      <ul aria-label={`${label}: riesgos por clasificación`} className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
        {RISK_CLASSIFICATIONS.map((classification) => (
          <li key={classification} className={cn("inline-flex items-center gap-1", counts[classification] === 0 && "text-[var(--color-text-subtle)]")}>
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: RISK_BAND_FILL[classification], opacity: counts[classification] === 0 ? 0.35 : 1 }} />
            <span className="sr-only">{CLASSIFICATION_LABEL[classification]}: </span>
            {counts[classification]}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** La leyenda común de las barras de una lista: se pone una vez, no una por fila. */
export function RiskShareLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Clasificación del riesgo" className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]", className)}>
      {RISK_CLASSIFICATIONS.map((classification) => (
        <li key={classification} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: RISK_BAND_FILL[classification] }} />
          {CLASSIFICATION_LABEL[classification]}
        </li>
      ))}
    </ul>
  )
}
