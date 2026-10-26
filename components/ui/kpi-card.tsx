import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Delta } from "@/components/ui/delta"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { CHART_COLORS } from "@/lib/chart-palette"
import { KpiCardGlossary } from "./kpi-card-glossary"

/**
 * Tarjeta de KPI del producto.
 *
 * `sparkline` y `tone: "danger"` llegaron al absorber `MetricCell`, la tercera
 * implementación de tile que vivía en el dashboard (G-07). Son **opcionales**:
 * los consumidores anteriores (`/analitica`, PDTP, combustibles) no cambian.
 *
 * `numerals`, `surface`, `trendLabel`, `trendFormat` y `empty` son la variante
 * del tablero (panel único con divisiones finas y cifras sans; excepción a la
 * regla 7 de AGENTS.md). También opcionales: sin ellas el tile es el de siempre.
 */
export function KpiCard({
  icon,
  label,
  value,
  detail,
  trend,
  trendPolarity = "up-good",
  trendLabel,
  trendFormat = "percent",
  tone = "neutral",
  glossary,
  href,
  sparkline,
  secondaryAction,
  numerals = "mono",
  surface = "card",
  empty,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  trend?: number | null
  /**
   * Qué significa que la cifra suba. El default `up-good` es el histórico, pero
   * para gasto y consumo subir es MALA noticia: pintarlo verde presentaba un
   * alza de costo como éxito, y contradecía al panel de canales de al lado, que
   * ya usaba ámbar para lo mismo. `neutral` para volúmenes que no son ni bueno
   * ni malo por sí solos (litros entregados, transacciones).
   */
  trendPolarity?: "up-good" | "up-bad" | "neutral"
  /** Contra qué se compara la variación ("vs. sep"). */
  trendLabel?: string
  /** `percent` (histórico) o `number` para variaciones en unidades. */
  trendFormat?: "percent" | "number"
  tone?: "neutral" | "signal" | "danger"
  glossary?: string
  href?: string
  /** Serie real; se dibuja sólo con ≥2 puntos. Nunca una serie inventada. */
  sparkline?: number[]
  /**
   * Un segundo destino dentro del tile (p. ej. "3 por aprobar →"). Como el tile
   * entero ya es un enlace y un `<a>` no puede contener otro, con esta opción el
   * enlace principal pasa a ser una capa que cubre la tarjeta y el secundario
   * queda por encima.
   */
  secondaryAction?: { label: string; href: string }
  /** `sans` para el tablero; `mono` es el lenguaje del resto de la app. */
  numerals?: "mono" | "sans"
  /**
   * `flat`: celda de `DashboardPanel`, sin radio, borde propio ni sombra; las
   * divisiones son su borde superior e izquierdo.
   */
  surface?: "card" | "flat"
  /**
   * Tile sin dato (regla A1): en vez de "$0" o "Sin datos", dice qué significa y
   * qué hacer. `actionLabel` se pinta como enlace; el destino es `href`.
   */
  empty?: { message: string; actionLabel?: string }
}) {
  const hasSparkline = Array.isArray(sparkline) && sparkline.length >= 2
  const flat = surface === "flat"
  // Un tile vacío no muestra variación: "↓ 100 %" junto a «Sin OC emitidas»
  // se leía como una baja buena, cuando lo que pasó es que no hubo nada.
  const showTrend = typeof trend === "number" && !empty
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[var(--color-text-subtle)] truncate">{label}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasSparkline && <MiniSparkline data={sparkline!} color={CHART_COLORS.signal} />}
          {icon && (
            <span className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
              flat && "transition-colors duration-[var(--duration-fast)] group-hover/kpi:bg-[var(--color-primary-tint)] group-hover/kpi:text-[var(--color-primary-ink)]",
            )}>
              {icon}
            </span>
          )}
          {glossary && <KpiCardGlossary content={glossary} />}
        </div>
      </div>

      {empty ? (
        <p className="mt-2 text-base font-semibold leading-snug text-[var(--color-text-muted)]">{empty.message}</p>
      ) : (
        <p className={cn(
          // Anillo y cifra comparten tono (TIUX-15): `signal` pintaba el anillo
          // naranja y la cifra verde primario, dos señales contradictorias.
          // Texto con `-ink` (AGENTS.md regla 8): el naranja base no pasa AA.
          "mt-2 tabular-nums tracking-tight",
          numerals === "sans" ? "font-sans text-[28px] font-semibold leading-none" : "font-mono text-2xl font-bold",
          tone === "danger" ? "text-[var(--color-danger-ink)]" : tone === "signal" ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
        )}>{value}</p>
      )}

      {empty?.actionLabel ? (
        <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)]">
          {empty.actionLabel}
          <ArrowRight size={12} weight="bold" aria-hidden className="transition-transform duration-[var(--duration-fast)] group-hover/kpi:translate-x-0.5" />
        </span>
      ) : (showTrend || detail) && (
        // `items-start gap-2` es la fila histórica (los usos fuera del tablero no
        // cambian); en el panel del tablero la variación y su rótulo pueden saltar
        // de línea.
        <div className={cn("mt-2.5 text-xs", flat ? "flex flex-wrap items-center gap-x-2 gap-y-1" : "flex items-start gap-2")}>
          {showTrend && (
            <Delta value={trend} format={trendFormat} polarity={trendPolarity} comparisonLabel={trendLabel} />
          )}
          {detail && (
            // 2 líneas y no `truncate`: a 1366 con sidebar abierto los cuatro
            // tiles cortaban su detalle con elipsis (I-08).
            <span className="line-clamp-2 text-xs text-[var(--color-text-muted)]">{detail}</span>
          )}
        </div>
      )}
      {secondaryAction && (
        <Link
          href={secondaryAction.href}
          // min-h-6: objetivo táctil de 24 px (WCAG 2.5.8), también sobre la capa del enlace principal.
          className="relative z-10 mt-1.5 inline-flex min-h-6 items-center self-start text-xs font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:underline"
        >
          {secondaryAction.label}
        </Link>
      )}
    </>
  )

  const overlay = secondaryAction && href && (
    <Link href={href} aria-label={`${label}: ${empty?.message ?? value}`} className="absolute inset-0 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" />
  )

  const card = flat ? (
    // Ancla estable para el conteo automatizado que TASK-UI-006 exige como
    // evidencia: el criterio es "máximo cuatro tiles por pantalla".
    <div data-kpi-card="" className={cn(
      "group/kpi relative flex h-full flex-col border-l border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4",
      "transition-colors duration-[var(--duration-fast)]",
      href && "hover:bg-[var(--color-surface-2)]",
      // En el panel no hay anillo: la señal es una franja a la izquierda.
      tone === "signal" && "shadow-[inset_3px_0_0_var(--color-signal)]",
      tone === "danger" && "shadow-[inset_3px_0_0_var(--color-danger)]",
    )}>
      {body}
      {overlay}
    </div>
  ) : (
    // Ancla estable para el conteo automatizado que TASK-UI-006 exige como
    // evidencia: el criterio es "máximo cuatro tiles por pantalla" y sin un
    // selector fiable sólo podía comprobarse a ojo.
    <Card data-kpi-card="" className={cn(
      "group/kpi transition-[background-color,border-color,box-shadow] duration-(--duration-fast)",
      secondaryAction && "relative",
      tone === "signal" && "ring-1 ring-[var(--color-signal-line)]",
      tone === "danger" && "ring-1 ring-[var(--color-danger-line)]",
    )}>
      <CardContent className="p-4 flex flex-col justify-between">{body}</CardContent>
      {overlay}
    </Card>
  )
  if (secondaryAction) return card
  return href
    ? <Link href={href} className={cn("block h-full", flat && "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]")}>{card}</Link>
    : card
}
