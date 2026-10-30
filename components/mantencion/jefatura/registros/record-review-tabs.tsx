import Link from "next/link"
import type { MantReview } from "@/lib/mantencion/types"
import { cn } from "@/lib/utils"

interface ReviewTab {
  /** Valor del parámetro `revision`; `null` = «Todos» (sin parámetro). */
  value: MantReview | null
  label: string
}

const TABS: ReviewTab[] = [
  { value: "pendiente", label: "Por revisar" },
  { value: "observado", label: "Observados" },
  { value: "revisado", label: "Revisados" },
  { value: null, label: "Todos" },
]

/**
 * Pestañas de revisión de «Registros»: «Por revisar (N)», «Observados (N)»,
 * «Revisados (N)» y «Todos». Son la ÚNICA representación de la revisión (regla
 * A5: no hay además un select ni un tile), y los contadores respetan los demás
 * filtros de la lista.
 *
 * Mismo trazo que `StageTabs` (subrayado, contador mono), pero aquel está atado
 * al parámetro `estado` y aquí el parámetro es `revision`. Son `<Link>` con el
 * enlace ya armado por el servidor: navegan desde el primer pintado, sin esperar
 * hidratación, y no mueven el scroll.
 */
export function RecordReviewTabs({
  counts,
  current,
  hrefFor,
}: {
  counts: Record<MantReview, number>
  current: MantReview | null
  hrefFor: (value: MantReview | null) => string
}) {
  return (
    <nav
      aria-label="Revisión de los registros"
      className="-mx-1 mb-3 flex max-w-full items-end overflow-x-auto border-b border-[var(--color-border)] px-1"
    >
      {TABS.map((tab) => {
        const active = current === tab.value
        const count = tab.value ? counts[tab.value] : null
        return (
          <Link
            key={tab.value ?? "todos"}
            href={hrefFor(tab.value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 text-sm font-medium sm:min-h-9",
              "transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
              active
                ? "border-[var(--color-text)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
            )}
          >
            {tab.label}
            {count !== null && (
              <span
                className={cn(
                  "ml-1 font-mono text-xs tabular-nums",
                  // Lo por revisar es trabajo pendiente: lleva el tono de señal mientras haya algo.
                  tab.value === "pendiente" && count > 0
                    ? "font-semibold text-[var(--color-signal-ink)]"
                    : active ? "opacity-80" : "text-[var(--color-text-faint)]",
                )}
              >
                {/* El espacio es del nombre accesible («Por revisar 3»); la separación visual es el margen. */}
                {" "}{count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
