import Link from "next/link"
import { useId, type ReactNode } from "react"
import { ArrowRight, CaretDown } from "@phosphor-icons/react/dist/ssr"
import { Card } from "@/components/ui/card"
import { ChartEmpty } from "@/components/ui/chart-empty"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { cn } from "@/lib/utils"

/**
 * Marco común de un gráfico **en una pantalla de módulo** (fuera del tablero,
 * que usa `ChartFrame` dentro de un `DashboardPanel`).
 *
 * Nació en la Fase 1 de `AUDITORIA_VISUALIZACIONES_CHOME.md`: cada gráfico de
 * módulo resolvía por su cuenta —o no resolvía— cinco cosas que deben ser
 * iguales en toda la plataforma:
 *
 * 1. **Nombre accesible.** Es un `<figure>` cuyo nombre es el título; el gráfico
 *    de adentro es decoración para el lector de pantalla salvo que diga otra cosa.
 * 2. **La respuesta antes que el dibujo.** `summary` es la frase que contesta la
 *    pregunta del gráfico («12 de 40 personas tienen capacitaciones vencidas»).
 *    Se lee primero y es lo que anuncia el lector de pantalla.
 * 3. **«Ver datos».** Con `data`, los mismos números en una tabla a demanda
 *    (`ChartDataTable`): para quien no ve el gráfico y para quien quiere la cifra.
 * 4. **Estado vacío con salida.** Con `empty`, el gráfico no se dibuja y se
 *    explica qué falta y cómo llenarlo (regla A4), nunca un eje en cero.
 * 5. **Drill-down.** Con `drillHref`, un enlace a la lista que explica la cifra.
 *
 * La superficie es la tarjeta flotante estándar (regla 7 de AGENTS.md). Para
 * meterlo dentro de otra tarjeta, `bare` quita borde y padding.
 */
export interface ChartSectionProps {
  title: string
  /** Nivel del título en el esquema de la página. Por defecto `h2`. */
  headingLevel?: 2 | 3
  /** Frase que responde la pregunta del gráfico. */
  summary?: ReactNode
  /** Control o enlace a la derecha del título (selector de período, leyenda). */
  aside?: ReactNode
  /** Datos para «Ver datos». La primera columna es el encabezado de fila. */
  data?: { caption?: string; headers: string[]; rows: Array<Array<ReactNode>> }
  /** Si viene, reemplaza el gráfico: qué significa el vacío y qué hacer. */
  empty?: { label: string; hint?: string; ctaLabel?: string; ctaHref?: string } | null
  drillHref?: string
  drillLabel?: string
  /** Sin tarjeta propia (va dentro de otra superficie). */
  bare?: boolean
  /**
   * El título y la frase quedan siempre a la vista y el gráfico (con «Ver datos» y
   * el drill-down) se abre a demanda. Para un gráfico que encabeza una bandeja de
   * trabajo: la respuesta se lee sin empujar la tabla bajo el pliegue. Nativo
   * (`<details>`), sin JS; cerrado por defecto (`defaultOpen` lo abre). Un estado
   * vacío no se pliega: explicar el vacío es lo único que hay que mostrar.
   */
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
  children?: ReactNode
}

export function ChartSection({
  title,
  headingLevel = 2,
  summary,
  aside,
  data,
  empty,
  drillHref,
  drillLabel = "Ver detalle",
  bare = false,
  collapsible = false,
  defaultOpen = false,
  className,
  children,
}: ChartSectionProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  const titleId = useId()
  const chart = (
    <>
      <div className="mt-4 min-w-0">{children}</div>
      {(data || drillHref) && (
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4">
          {data ? <ChartDataTable caption={data.caption ?? title} headers={data.headers} rows={data.rows} /> : <span />}
          {drillHref && (
            <Link
              href={drillHref}
              className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8"
            >
              {drillLabel}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </>
  )
  const body = (
    <figure aria-labelledby={titleId} className="m-0 flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <figcaption className="min-w-0">
          <Heading id={titleId} className="text-sm font-semibold text-[var(--color-text)]">{title}</Heading>
          {summary && !empty && <p className="mt-1 text-sm text-[var(--color-text-muted)] text-pretty">{summary}</p>}
        </figcaption>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {empty ? (
        <ChartEmpty className="mt-4 h-48" label={empty.label} hint={empty.hint} ctaLabel={empty.ctaLabel} ctaHref={empty.ctaHref} />
      ) : collapsible ? (
        <details open={defaultOpen} className="group/fold">
          <summary className="mt-2 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs font-semibold text-[var(--color-primary-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-8 [&::-webkit-details-marker]:hidden">
            <span className="group-open/fold:hidden">Ver gráfico</span>
            <span className="hidden group-open/fold:inline">Ocultar gráfico</span>
            <CaretDown className="size-3.5 transition-transform group-open/fold:rotate-180" aria-hidden />
          </summary>
          {chart}
        </details>
      ) : chart}
    </figure>
  )
  if (bare) return <div className={cn("min-w-0", className)}>{body}</div>
  return <Card className={cn("min-w-0 p-5 md:p-6", className)}>{body}</Card>
}

