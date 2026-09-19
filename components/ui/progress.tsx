import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Barra de avance.
 *
 * Existía dos veces escrita a mano —en `summary-bar-stat-cell.tsx` y en
 * `pdtp-compliance-card.tsx`— y las dos copias ya habían divergido: una anuncia
 * el label a secas y la otra una frase compuesta, una satura el ancho en 0% y
 * la otra deja un sliver del 2% para que el usuario vea que la barra existe.
 * Son diferencias legítimas, así que acá son props y no un tercer criterio.
 *
 * `label` es obligatorio: sin él la barra es un div de color que ningún lector
 * de pantalla puede narrar, y `role="progressbar"` sin nombre accesible es peor
 * que no tener el rol.
 */

export interface ProgressMarker {
  /** Posición en la misma escala que `value` (no en porcentaje). */
  at: number
  /** Se muestra al posar el puntero; la barra la expone sólo como `title`
   *  porque la narración del avance ya va en `label`. */
  label: string
  /** Un poco más alto y más oscuro: para la referencia principal. */
  emphasis?: boolean
}

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "role"> {
  value: number
  max?: number
  /** Nombre accesible. Una frase completa cuando la barra resume varias cosas. */
  label: string
  tone?: "primary" | "signal" | "warning" | "danger"
  size?: "sm" | "md"
  /**
   * Porcentaje mínimo pintado cuando `value` es mayor que cero. Evita que un
   * avance real pero diminuto se vea idéntico a no haber empezado.
   */
  minVisible?: number
  markers?: ProgressMarker[]
}

const TONE_FILL: Record<NonNullable<ProgressProps["tone"]>, string> = {
  primary: "bg-[var(--color-primary)]",
  signal: "bg-[var(--color-signal)]",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
}

const SIZE_TRACK: Record<NonNullable<ProgressProps["size"]>, string> = {
  sm: "h-1",
  md: "h-2",
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function Progress({
  value,
  max = 100,
  label,
  tone = "primary",
  size = "md",
  minVisible = 0,
  markers,
  className,
  ...props
}: ProgressProps) {
  const safeMax = max > 0 ? max : 100
  const percent = clampPercent((value / safeMax) * 100)
  const painted = percent > 0 ? Math.max(percent, minVisible) : 0

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.min(safeMax, Math.max(0, value))}
      className={cn(
        "relative w-full rounded-full bg-[var(--color-surface-2)]",
        // `overflow-visible` sólo cuando hay marcadores: sobresalen del riel a
        // propósito, y recortarlos los volvería invisibles.
        markers && markers.length > 0 ? "overflow-visible" : "overflow-hidden",
        SIZE_TRACK[size],
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]",
          TONE_FILL[tone],
        )}
        style={{ width: `${painted}%` }}
      />
      {markers?.map((marker) => (
        <span
          key={`${marker.at}:${marker.label}`}
          className={cn(
            "absolute w-px rounded-full",
            marker.emphasis
              ? "top-[-3px] h-3.5 w-0.5 bg-[var(--color-rule)]"
              : "top-[-2px] h-3 bg-[var(--color-text-faint)]",
          )}
          style={{ left: `${clampPercent((marker.at / safeMax) * 100)}%` }}
          title={marker.label}
          aria-hidden
        />
      ))}
    </div>
  )
}
