import Link from "next/link"
import { cn } from "@/lib/utils"
import { tabHref } from "@/lib/services/mantencion/looker/filters"
import type { LookerTab } from "@/lib/services/mantencion/looker/types"

const PANEL = "/mantencion/panel"

const TABS: Array<{ value: LookerTab; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "planificacion", label: "Planificación" },
  // Se reparten por la unidad del equipo, no por su tipo: un camión de producción medido en horas está en «Por horas».
  // El valor de la URL (`camiones`, `maquinas`) no cambia: hay enlaces guardados.
  { value: "camiones", label: "Por kilómetros" },
  { value: "maquinas", label: "Por horas" },
]

/**
 * Pestañas del Panel. Cada una es un enlace que lleva `pestana` y conserva el período y la faena de la URL actual
 * (`desde`, `hasta`, `faena`): quien eligió «enero a octubre» en una faena no los pierde al cambiar de pestaña. Los
 * filtros cruzados (`x_*`), el equipo, la frecuencia y la página sí se reinician, porque son de la pestaña que se deja.
 * No es un control de formulario.
 */
export function PanelTabs({ active, params }: { active: LookerTab; /** Los parámetros de la URL actual, tal como los entrega la página. */ params: Record<string, string | string[] | undefined> }) {
  return (
    <nav
      aria-label="Secciones del panel de mantención"
      className="-mx-1 mb-4 flex items-end gap-0 overflow-x-auto border-b border-[var(--color-border)] px-1"
    >
      {TABS.map((tab) => {
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
  )
}
