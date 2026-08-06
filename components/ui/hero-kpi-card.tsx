import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

/**
 * El primer tile de una fila, relleno en verde profundo.
 *
 * Un ancla visual por fila: con cuatro tarjetas blancas idénticas la mirada no
 * tiene dónde caer primero. `--color-primary-deep` existe en el design system
 * documentado como "Fondo hero card" desde la migración visual y no se había
 * usado nunca. Su contraste contra el texto blanco lo fija
 * `components/__tests__/design-tokens-contrast.test.ts`.
 *
 * Conserva `data-kpi-card`: el conteo de densidad de `e2e/densidad-kpi.spec.ts`
 * cuenta por ese atributo, y un hero que no contara sería un hueco en la guarda.
 */
export function HeroKpiCard({ icon, label, value, detail, trend, href }: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  /** Variación porcentual ya calculada. `0` no es buena ni mala noticia. */
  trend?: number | null
  href?: string
}) {
  const card = (
    <div
      data-kpi-card=""
      className={cn(
        "flex h-full flex-col justify-between rounded-[var(--radius-xl)] p-4",
        "bg-[var(--color-primary-deep)] text-white shadow-[var(--shadow-card)]",
        "transition-all duration-(--duration-fast)",
        href && "hover:brightness-125",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-white/70">{label}</p>
        {icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-white/10 text-white">
            {icon}
          </span>
        )}
      </div>

      <p className="mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight text-white">{value}</p>

      <div className="mt-2.5 flex items-start gap-2 text-xs">
        {typeof trend === "number" && (
          // Sin verde/rojo: sobre el relleno de marca no se distinguirían. La
          // flecha carga el signo y el fondo translúcido lo separa del detalle.
          <span className="inline-flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {trend > 0 ? <ArrowUp size={11} weight="bold" /> : trend < 0 ? <ArrowDown size={11} weight="bold" /> : null}
            {Math.abs(trend)}%
          </span>
        )}
        {/* 2 líneas y no `truncate`: a 1366 con el sidebar abierto los cuatro
            tiles cortaban su detalle con elipsis (I-08). */}
        <span className="line-clamp-2 text-white/70">{detail}</span>
      </div>
    </div>
  )

  return href ? <Link href={href} className="block h-full">{card}</Link> : card
}
