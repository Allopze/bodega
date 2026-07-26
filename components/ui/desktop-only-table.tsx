import * as React from "react"
import { Desktop } from "@phosphor-icons/react/dist/ssr"

/**
 * Aviso para tablas de configuración que sólo tienen sentido en escritorio.
 *
 * A-1 pedía variante móvil para 13 tablas. Para las de configuración (roles,
 * folios, catálogos, importaciones desde Excel) portarlas a tarjetas sería
 * trabajo sin usuario: nadie administra permisos ni importa una planilla desde
 * el teléfono. Pero dejarlas cortadas en 390px sin explicación es peor que
 * decirlo: el usuario cree que la app está rota.
 *
 * Este componente hace explícita la decisión. La tabla sigue accesible por
 * scroll horizontal debajo; esto sólo añade el contexto que faltaba.
 */
export function DesktopOnlyTableNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-4 py-3 md:hidden">
      <Desktop size={16} className="mt-0.5 shrink-0 text-[var(--color-info-ink)]" />
      <div className="text-xs">
        <p className="font-medium text-[var(--color-info-ink)]">Pensada para escritorio</p>
        <p className="mt-0.5 text-[var(--color-text-muted)]">
          {children ?? "Esta tabla de configuración tiene muchas columnas. Puedes desplazarla en horizontal, pero se opera mucho mejor desde un computador."}
        </p>
      </div>
    </div>
  )
}
