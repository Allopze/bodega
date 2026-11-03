import Link from "next/link"
import { cn, pluralize } from "@/lib/utils"

/**
 * Barra 100 % de las partes **excluyentes** de un total, más su leyenda numérica.
 *
 * Para preguntas del tipo «¿cómo se reparten N cosas entre estas etapas?» cuando
 * cada cosa está en una sola parte (el estado de una solicitud). Si las cifras no
 * suman el total —varias etapas a la vez, unidades distintas— no es esta barra.
 *
 * Es el hermano de `AgingBar` para magnitudes que no son antigüedad: acá el color
 * lo decide quien llama (`color` es un token, nunca un hex; un estado usa los
 * semánticos y una categoría la serie de `lib/chart-palette.ts`) y el orden es el
 * recibido, que debe ser el del dominio (un ciclo de vida), no el del tamaño.
 *
 * El color nunca carga solo el significado: cada parte lleva su rótulo y su cifra
 * en la leyenda, que es también el único lugar con enlaces. Los segmentos de la
 * barra son sólo dibujo: un enlace dentro de `role="img"` es un control anidado
 * (axe `nested-interactive`) aunque vaya oculto y fuera del tabulador.
 *
 * `StatusShareBar` del tablero no sirve para esto: vive dentro del `ChartFrame` de
 * `/dashboard`, no enlaza y es de cliente. Éste cuelga de `ChartSection`.
 */
export interface ShareSegment {
  key: string
  label: string
  count: number
  /** Relleno del segmento y de su marca en la leyenda: un `var(--color-*)`. */
  color: string
  href?: string
  /** Parte elegida como filtro vigente: se marca y las demás pasan a segundo plano. */
  active?: boolean
}

export function ShareBar({
  label,
  segments,
  noun = "",
  inPlace = false,
  className,
}: {
  /** Nombre accesible de la barra (p. ej. «Solicitudes por estado»). */
  label: string
  segments: ShareSegment[]
  /** Sustantivo **en singular** de la cifra para la descripción accesible («solicitud»). */
  noun?: string
  /**
   * Los enlaces filtran **esta misma pantalla**: reemplazan la entrada del
   * historial y no mueven el scroll, como los demás filtros de URL.
   */
  inPlace?: boolean
  className?: string
}) {
  const shown = segments.filter((segment) => segment.count > 0)
  const total = shown.reduce((sum, segment) => sum + segment.count, 0)
  if (total === 0) return null

  const share = (segment: ShareSegment) => Math.round((segment.count / total) * 100)
  const description = shown
    .map((segment) => `${segment.label}: ${segment.count}${noun ? ` ${pluralize(segment.count, noun)}` : ""} (${share(segment)} %)`)
    .join("; ")
  const anyActive = shown.some((segment) => segment.active)
  const linkProps = inPlace ? ({ replace: true, scroll: false } as const) : {}

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={`${label}. ${description}`}
        className="flex h-4 gap-0.5 overflow-hidden rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border)]"
      >
        {shown.map((segment) => {
          // Los segmentos son sólo dibujo: un enlace dentro de `role="img"` es un
          // control anidado (axe `nested-interactive`) aunque lleve aria-hidden y
          // tabIndex -1. El filtro vive en la leyenda, que es lo que se enfoca.
          return (
            <div
              key={segment.key}
              data-segment={segment.key}
              title={`${segment.label}: ${segment.count} (${share(segment)} %)`}
              style={{ width: `${(segment.count / total) * 100}%`, background: segment.color }}
              // Una parte de 1 sobre 200 mide menos de un píxel y no se vería.
              className={cn("h-full min-w-[3px] shrink", anyActive && !segment.active && "opacity-40")}
            />
          )
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {shown.map((segment) => {
          const content = (
            <>
              <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} />
              <span className="text-[var(--color-text-muted)]">{segment.label}</span>
              <span className="font-semibold tabular-nums text-[var(--color-text)]">{segment.count.toLocaleString("es-CL")}</span>
            </>
          )
          const itemClass = "inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius)] px-1.5 text-xs"
          return (
            <li key={segment.key}>
              {segment.href ? (
                <Link
                  href={segment.href}
                  {...linkProps}
                  aria-current={segment.active ? "true" : undefined}
                  className={cn(
                    itemClass,
                    "hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2",
                    segment.active && "bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-primary)]",
                  )}
                >
                  {content}
                </Link>
              ) : (
                <span className={itemClass}>{content}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
