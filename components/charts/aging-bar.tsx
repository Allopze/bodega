import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Antigüedad en tramos: una barra apilada horizontal + su leyenda numérica.
 *
 * Para preguntas del tipo «¿cuánto lleva esperando lo que está pendiente?»
 * (aprobaciones, deuda, solicitudes). Los tramos van SIEMPRE en orden
 * cronológico (del más reciente al más antiguo), nunca ordenados por tamaño:
 * el orden es parte del dato.
 *
 * El color es **secuencial**, no categórico: el primer tramo es el gris de
 * referencia y cada tramo siguiente se acerca al rojo del sistema. Así el ojo
 * lee «más a la derecha = más grave» sin leyenda, y ningún tono se confunde
 * con una categoría de otra serie. Cada tramo lleva su cifra visible, de modo
 * que el color no carga solo el significado.
 *
 * Con `href` por tramo, cada uno lleva a su subconjunto (regla A1: accionable).
 * Cuando el gráfico es además el **selector** de un filtro de la misma pantalla
 * (`inPlace`), el tramo elegido se marca (`active`) y su enlace es la salida.
 */
export interface AgingBucket {
  label: string
  count: number
  /** Cifra secundaria (p. ej. monto) que se muestra junto al conteo. */
  detail?: string
  href?: string
  /** Tramo elegido como filtro vigente: se marca y se anuncia con `aria-current`. */
  active?: boolean
}

export function AgingBar({
  label,
  buckets,
  unit = "",
  inPlace = false,
  className,
}: {
  /** Nombre accesible de la barra (p. ej. «Pendientes de aprobación por antigüedad»). */
  label: string
  buckets: AgingBucket[]
  /** Sustantivo de la cifra para la descripción accesible («solicitudes»). */
  unit?: string
  /**
   * Los enlaces filtran **esta misma pantalla** (no llevan a otra): reemplazan la
   * entrada del historial y no mueven el scroll, como el resto de los filtros de
   * URL (ver «Navigation and scroll preservation pattern» de AGENTS.md).
   */
  inPlace?: boolean
  className?: string
}) {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.count), 0)
  const description = buckets.map((bucket) => `${bucket.label}: ${bucket.count}${unit ? ` ${unit}` : ""}`).join("; ")
  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={`${label}. ${description}`}
        className="flex h-3 gap-px overflow-hidden rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border)]"
      >
        {total > 0 &&
          buckets.map((bucket, index) =>
            bucket.count > 0 ? (
              <div
                key={bucket.label}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(bucket.count / total) * 100}%`, background: agingColor(index, buckets.length) }}
              />
            ) : null,
          )}
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
        {buckets.map((bucket, index) => {
          const content = (
            <>
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: agingColor(index, buckets.length) }} />
                {bucket.label}
              </span>
              <span className="mt-0.5 block text-base font-semibold tabular-nums text-[var(--color-text)]">
                {bucket.count.toLocaleString("es-CL")}
                {bucket.detail && <span className="ml-1.5 text-xs font-normal text-[var(--color-text-muted)]">{bucket.detail}</span>}
              </span>
            </>
          )
          return (
            <li key={bucket.label} className="min-w-0">
              {bucket.href && (bucket.count > 0 || bucket.active) ? (
                <Link
                  href={bucket.href}
                  {...(inPlace ? { replace: true, scroll: false } : {})}
                  aria-current={bucket.active ? "true" : undefined}
                  className={cn(
                    "-mx-1.5 -my-1 block rounded-[var(--radius)] px-1.5 py-1 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2",
                    bucket.active && "bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-primary)]",
                  )}
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Tono del tramo `index` de `count`: del gris de referencia (0) al rojo del
 * sistema (último), interpolado en OKLCH para que los pasos se vean parejos.
 */
export function agingColor(index: number, count: number): string {
  if (count <= 1) return "var(--color-chart-reference)"
  const share = Math.round((index / (count - 1)) * 100)
  return `color-mix(in oklch, var(--color-danger) ${share}%, var(--color-chart-reference))`
}
