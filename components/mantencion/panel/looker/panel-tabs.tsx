import Link from "next/link"
import { cn } from "@/lib/utils"
import { tabHref } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { LookerTab } from "@/lib/services/mantencion/looker/types"

const PANEL = "/mantencion/panel"

export const PANEL_TABS: Array<{ value: LookerTab; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "planificacion", label: "Planificación" },
  { value: "correctivo", label: "Correctivo" },
  { value: "preventivo", label: "Preventivo" },
]

/** La pregunta que responde cada pestaña: va en una línea bajo las pestañas. «Hoy» lleva su propia descripción. */
export const TAB_QUESTION: Record<Exclude<LookerTab, "hoy">, string> = {
  planificacion: "¿Qué equipo necesita mantención y cuándo? Estado de hoy de cada equipo, sin período.",
  correctivo: "¿Qué se rompió, en qué equipo y cuánto trabajo costó en el período?",
  preventivo: "¿Se están cumpliendo las pautas y con qué evidencia?",
}

/**
 * Pestañas del Panel. Cada una es un enlace que lleva `pestana` y conserva la unidad, el período y la faena de la
 * URL actual (`unidad`, `desde`, `hasta`, `faena`): quien eligió «por horas, enero a octubre» en una faena no los
 * pierde al cambiar de pestaña. Los filtros propios de la pestaña que se deja (equipo, frecuencia, `x_*`, página,
 * estado, fechas y ficha) se reinician. Los valores viejos de la URL (`camiones`, `maquinas`) los redirige la página.
 * No es un control de formulario.
 */
export function PanelTabs({ active, params }: { active: LookerTab; /** Los parámetros de la URL actual, tal como los entrega la página. */ params: Record<string, string | string[] | undefined> }) {
  return (
    <div className="mb-4">
      <nav
        aria-label="Secciones del panel de mantención"
        className="-mx-1 flex items-end gap-0 overflow-x-auto border-b border-[var(--color-border)] px-1"
      >
        {PANEL_TABS.map((tab) => {
          const isActive = tab.value === active
          return (
            <Link
              key={tab.value}
              href={tabHref(PANEL, tab.value, params)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 text-sm font-medium sm:min-h-9",
                "transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
                isActive
                  ? "border-[var(--color-text)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
      {active !== "hoy" && (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">{TAB_QUESTION[active]}</p>
      )}
    </div>
  )
}
