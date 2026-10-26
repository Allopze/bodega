import Link from "next/link"
import { cn, formatCLP } from "@/lib/utils"

/*
 * CONTRATO (fase 0). La línea L1 completa el cuerpo: orden peor-primero en modo
 * `threshold`, "y N más" con `moreHref`, medidor compacto con ≤2 ítems, relleno
 * animado con `motion-safe:` y atenuación de las otras filas al apuntar una.
 * La interfaz pública no cambia sin coordinar con L3 y L4, que la consumen.
 */

export interface RankedListItem {
  key: string
  label: string
  value: number
  /** Texto secundario ("12 de 40", "3 facturas"). */
  detail?: string
  href?: string
}

export type RankedListFormat = "clp" | "count" | "percent"

export interface RankedListProps {
  items: RankedListItem[]
  format: RankedListFormat
  /** Sufijo para `count` (" u.", " L"). */
  unit?: string
  /**
   * `share`: un solo tono, el largo es la proporción sobre el mayor y se muestra
   * el % del total. `threshold`: el color dice si el valor cumple (≥ good verde,
   * ≥ warn ámbar, si no rojo; `invert` lo da vuelta) y el largo es el valor
   * sobre 100.
   */
  mode?: "share" | "threshold"
  thresholds?: { good: number; warn: number; invert?: boolean }
  /** `desc` por defecto en share; en threshold, lo peor primero. `input` respeta el orden recibido. */
  order?: "desc" | "asc" | "input"
  /** Máximo de filas visibles; el resto se resume en "y N más". */
  limit?: number
  moreHref?: string
  /** % del total junto al valor (sólo `share`). Por defecto, sí. */
  showShare?: boolean
  /** Nombre accesible de la lista. */
  ariaLabel: string
  className?: string
}

export function formatRankedValue(value: number, format: RankedListFormat, unit = "") {
  if (format === "clp") return formatCLP(value)
  if (format === "percent") return `${Math.round(value)}%`
  return `${value.toLocaleString("es-CL")}${unit}`
}

/**
 * Ranking como lista: nombre y valor legibles sobre una barra de fondo de un
 * solo tono (patrón `ShareBarList` de la referencia). Reemplaza a los gráficos
 * de barras con un color por barra, donde el color no codificaba nada.
 *
 * Server-safe: sin hooks; las transiciones son CSS.
 */
export function RankedList({ items, format, unit, mode = "share", order, limit = 8, moreHref, showShare = true, ariaLabel, className }: RankedListProps) {
  const sorted = order === "input" ? items : [...items].sort((a, b) => (order === "asc" ? a.value - b.value : b.value - a.value))
  const visible = sorted.slice(0, limit)
  const max = mode === "threshold" ? 100 : Math.max(1, ...visible.map((item) => item.value))
  const total = items.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className={className}>
      <ul aria-label={ariaLabel} className="flex flex-col gap-0.5">
        {visible.map((item) => {
          const row = (
            <>
              <span aria-hidden className="absolute inset-y-0 left-0 border-r-2 border-[color-mix(in_oklch,var(--color-primary)_70%,transparent)] bg-[linear-gradient(to_right,color-mix(in_oklch,var(--color-primary)_4%,transparent),color-mix(in_oklch,var(--color-primary)_22%,transparent))]" style={{ width: `${Math.min(100, (item.value / max) * 100)}%` }} />
              <span className="relative truncate text-sm">{item.label}</span>
              <span className="relative flex shrink-0 items-baseline gap-2.5 text-sm font-semibold tabular-nums">
                {formatRankedValue(item.value, format, unit)}
                {mode === "share" && showShare && total > 0 && (
                  <span className="min-w-10 text-right text-xs font-normal text-[var(--color-text-muted)]">{Math.round((item.value / total) * 1000) / 10}%</span>
                )}
              </span>
            </>
          )
          const rowClass = "relative flex h-10 items-center justify-between gap-3 overflow-hidden rounded-md px-3"
          return (
            <li key={item.key}>
              {item.href ? <Link href={item.href} className={cn(rowClass, "hover:bg-[var(--color-surface-2)]")}>{row}</Link> : <div className={rowClass}>{row}</div>}
            </li>
          )
        })}
      </ul>
      {sorted.length > visible.length && moreHref && (
        <Link href={moreHref} className="mt-2 inline-flex text-xs font-semibold text-[var(--color-primary)] hover:underline">
          y {sorted.length - visible.length} más
        </Link>
      )}
    </div>
  )
}
