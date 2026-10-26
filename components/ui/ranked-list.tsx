import Link from "next/link"
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { cn, formatCLP, formatQty, formatPercent } from "@/lib/utils"

/*
 * Contrato (fase 0): la interfaz pública (`RankedListProps`, `RankedListItem`,
 * `formatRankedValue`) no cambia sin coordinar con quienes la consumen (las
 * secciones del tablero). El cuerpo es lo que completó la línea L1.
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
   * ≥ warn ámbar, si no rojo; `invert` lo da vuelta: ≤ good verde, ≤ warn ámbar,
   * si no rojo, para cifras donde menos es mejor) y el largo es el valor sobre 100.
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
  if (format === "percent") return formatPercent(value, 0)
  return `${formatQty(value)}${unit}`
}

type Tone = "share" | "good" | "warn" | "bad"

/*
 * Cada tono fija un matiz (`--rank-hue`) que el relleno consume y el color del
 * texto del valor. El texto va siempre con la variante `-ink` (AGENTS.md,
 * regla 8): el naranja y el verde base no pasan AA como texto.
 */
const TONE_CLASSES: Record<Tone, { hue: string; text: string }> = {
  share: { hue: "[--rank-hue:var(--color-primary)]", text: "text-[var(--color-text)]" },
  good: { hue: "[--rank-hue:var(--color-primary)]", text: "text-[var(--color-success-ink)]" },
  warn: { hue: "[--rank-hue:var(--color-signal)]", text: "text-[var(--color-signal-ink)]" },
  bad: { hue: "[--rank-hue:var(--color-danger)]", text: "text-[var(--color-danger-ink)]" },
}

/** El color solo no basta (WCAG 1.4.1): el estado también se dice a lectores de pantalla. */
const TONE_SR: Record<Exclude<Tone, "share">, string> = { good: "bien", warn: "atención", bad: "crítico" }

function toneFor(value: number, thresholds: { good: number; warn: number; invert?: boolean }): Exclude<Tone, "share"> {
  if (thresholds.invert) {
    if (value <= thresholds.good) return "good"
    if (value <= thresholds.warn) return "warn"
    return "bad"
  }
  if (value >= thresholds.good) return "good"
  if (value >= thresholds.warn) return "warn"
  return "bad"
}

function formatShare(fraction: number) {
  return formatPercent(fraction * 100)
}

/** Entrada del relleno: crece desde la izquierda; sin movimiento si el usuario lo pidió. */
const FILL_MOTION = "origin-left motion-safe:animate-[bar-grow-x_.9s_var(--ease-out)_both]"

/** Escalonado corto: las filas se llenan en secuencia, no todas a la vez. */
function fillDelay(index: number) {
  return { animationDelay: `${Math.min(index, 12) * 70}ms` }
}

/**
 * Ranking como lista: nombre y valor legibles sobre una barra de fondo de un
 * solo tono (patrón `ShareBarList` de la referencia). Reemplaza a los gráficos
 * de barras con un color por barra, donde el color no codificaba nada.
 *
 * Server-safe: sin hooks; las transiciones y la entrada son CSS.
 */
export function RankedList({
  items,
  format,
  unit,
  mode = "share",
  thresholds,
  order,
  limit = 8,
  moreHref,
  showShare = true,
  ariaLabel,
  className,
}: RankedListProps) {
  if (items.length === 0) return null

  const isThreshold = mode === "threshold"
  // Mismos umbrales que `ThresholdRankingChart`, al que este componente reemplaza.
  const limits = thresholds ?? { good: 80, warn: 50 }
  // Por defecto, el ranking de proporciones va de mayor a menor y el de
  // cumplimiento pone lo peor arriba, que es lo que pide una acción.
  const direction = order ?? (isThreshold && !limits.invert ? "asc" : "desc")
  const sorted = direction === "input" ? items : [...items].sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value))
  const visible = sorted.slice(0, Math.max(1, Math.floor(limit)))
  const hidden = sorted.length - visible.length
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  // La escala sale de todas las filas y no sólo de las visibles: con orden
  // ascendente y límite, el largo debe seguir midiendo contra el mayor real.
  const max = Math.max(1, ...items.map((item) => item.value))
  const compact = items.length <= 2

  const toneOf = (item: RankedListItem): Tone => (isThreshold ? toneFor(item.value, limits) : "share")
  const fractionOf = (item: RankedListItem) => {
    const raw = isThreshold ? item.value / 100 : compact ? (total > 0 ? item.value / total : 0) : item.value / max
    return Math.min(1, Math.max(0, raw))
  }
  const shareOf = (item: RankedListItem) => (!isThreshold && showShare && total > 0 ? formatShare(Math.max(0, item.value) / total) : null)

  return (
    <div className={className}>
      <ul aria-label={ariaLabel} className={cn("group/rank flex flex-col", compact ? "gap-3" : "gap-0.5")}>
        {visible.map((item, index) => {
          const tone = toneOf(item)
          const toneClasses = TONE_CLASSES[tone]
          const fraction = fractionOf(item)
          const zero = item.value <= 0
          const share = shareOf(item)
          const value = formatRankedValue(item.value, format, unit)
          const srTone = tone === "share" ? null : TONE_SR[tone]
          const shareNode = share && (
            <span className="min-w-10 text-right text-xs font-normal text-[var(--color-text-muted)]">
              {share}
              <span className="sr-only"> del total</span>
            </span>
          )
          const toneNode = srTone && <span className="sr-only"> ({srTone})</span>
          // Atenúa las otras filas al apuntar una. `hover:`/`focus-visible:`
          // la devuelven a opacidad plena: la propia fila es descendiente del grupo.
          const liClass = cn(
            toneClasses.hue,
            "group/row transition-opacity duration-[var(--duration-fast)] group-hover/rank:opacity-60 hover:opacity-100 focus-within:opacity-100",
          )

          if (compact) {
            const body = (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-[var(--color-text)]" title={item.label}>{item.label}</span>
                  <span className={cn("flex shrink-0 items-baseline gap-2 text-lg font-semibold tabular-nums", toneClasses.text)}>
                    {value}
                    {toneNode}
                    {shareNode}
                    {item.href && <CaretRight size={14} aria-hidden className="self-center text-[var(--color-text-muted)] opacity-0 transition-[opacity,translate] duration-200 -translate-x-1 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100" />}
                  </span>
                </div>
                <div aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className={cn("h-full rounded-full bg-[var(--rank-hue)]", FILL_MOTION)}
                    style={{ width: `${fraction * 100}%`, ...fillDelay(index) }}
                  />
                </div>
                {item.detail && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{item.detail}</p>}
              </>
            )
            const compactClass = "block rounded-md px-3 py-2"
            return (
              <li key={item.key} data-tone={tone} className={liClass}>
                {item.href ? (
                  <Link href={item.href} className={cn(compactClass, "hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]")}>{body}</Link>
                ) : (
                  <div className={compactClass}>{body}</div>
                )}
              </li>
            )
          }

          const rowClass = "relative flex h-10 items-center justify-between gap-3 overflow-hidden rounded-md px-3"
          const row = (
            <>
              <span
                aria-hidden
                data-rank-fill=""
                className={cn(
                  "absolute inset-y-0 left-0 transition-[filter] duration-200 group-hover/row:[filter:saturate(1.6)_brightness(.96)]",
                  // Sin valor no hay borde de color: a 0% quedaría una raya de 2 px que parece un dato.
                  !zero && "bg-[linear-gradient(to_right,color-mix(in_oklch,var(--rank-hue)_4%,transparent),color-mix(in_oklch,var(--rank-hue)_22%,transparent))]",
                  // Con barras cortas el borde caía encima del nombre y lo tachaba
                  // (visto en "Distribución por módulo"); bajo un cuarto basta el relleno.
                  !zero && fraction >= 0.25 && "border-r-2 border-[color-mix(in_oklch,var(--rank-hue)_70%,transparent)]",
                  FILL_MOTION,
                )}
                style={{ width: `${fraction * 100}%`, ...fillDelay(index) }}
              />
              <span className="relative truncate text-sm" title={item.label}>{item.label}</span>
              <span className="relative flex shrink-0 items-baseline gap-2.5 text-sm tabular-nums">
                <span className={cn("font-semibold", toneClasses.text)}>{value}{toneNode}</span>
                {item.detail && <span className="text-xs font-normal text-[var(--color-text-muted)]">{item.detail}</span>}
                {shareNode}
                {item.href && (
                  <CaretRight
                    size={14}
                    aria-hidden
                    className="self-center text-[var(--color-text-muted)] opacity-0 -translate-x-1 transition-[opacity,translate] duration-200 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100"
                  />
                )}
              </span>
            </>
          )

          return (
            <li key={item.key} data-tone={tone} className={liClass}>
              {item.href ? (
                <Link href={item.href} className={cn(rowClass, "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]")}>{row}</Link>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          )
        })}
      </ul>
      {hidden > 0 &&
        (moreHref ? (
          <Link href={moreHref} className="mt-2 inline-flex text-xs font-semibold text-[var(--color-primary)] hover:underline">
            y {hidden} más
          </Link>
        ) : (
          // Sin destino al que mandar, igual se dice cuántas filas quedan fuera:
          // una lista truncada en silencio miente sobre su tamaño.
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">y {hidden} más</p>
        ))}
    </div>
  )
}
