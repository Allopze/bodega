import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Estado vacío de un contenedor de gráfico: la caja dashed estándar con un
 * mensaje, y opcionalmente un hint, un CTA o un ícono.
 *
 * Antes cada archivo de charts declaraba su propio placeholder con la misma
 * caja (9 copias) y alturas/bordes que se fueron
 * separando entre sí. Las tres variantes históricas quedan como ramas:
 * - caja plana (`h-48`): una línea centrada;
 * - con ícono (`h-64`, flex-col): ícono + texto muted;
 * - extendida (`h-64`): título + hint + CTA (analítica).
 * Cualquier otro matiz (altura, borde, redondeo) se pasa por `className`.
 */
interface ChartEmptyProps {
  label: string
  hint?: string
  ctaLabel?: string
  ctaHref?: string
  icon?: React.ReactNode
  className?: string
}

export function ChartEmpty({ label, hint, ctaLabel, ctaHref, icon, className }: ChartEmptyProps) {
  if (icon) {
    return (
      <div className={cn(
        "flex h-64 flex-col items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 text-center",
        className,
      )}>
        {icon}
        <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">{label}</p>
      </div>
    )
  }

  if (hint || ctaLabel) {
    return (
      <div className={cn(
        "flex h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 text-center",
        className,
      )}>
        <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
        {hint && <p className="max-w-sm text-xs text-[var(--color-text-muted)]">{hint}</p>}
        {ctaLabel && ctaHref && (
          <Link href={ctaHref} className="mt-1 text-xs font-medium text-[var(--color-primary-ink)] hover:underline">
            {ctaLabel} →
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      "flex h-48 items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 text-center text-sm text-[var(--color-text-muted)]",
      className,
    )}>
      {label}
    </div>
  )
}
