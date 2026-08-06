import Link from "next/link"
import { cn } from "@/lib/utils"
import { dashboardScopeHref, type DashboardScope } from "./dashboard-scope"
import type { DashboardView } from "./dashboard-views"

/**
 * El selector del tablero: **qué se quiere mirar**.
 *
 * Reemplaza a `DomainIndex`, que eran anclas `#dominio-*` sobre una página que
 * ya tenía las seis secciones montadas: navegaba con scroll, no conmutaba nada.
 * Estas son `<Link>` a `?vista=`, así que cada una es un render de servidor con
 * sus propias consultas y ninguna otra.
 *
 * `top-14` = alto de la TopBar (`h-[3.5rem]`), que es sticky en el mismo
 * contenedor de scroll con `z-10`. Con `top-0` la barra se pegaba **encima** del
 * título (I-05, auditoría 2026-08-05); `z-5 < z-10` deja ganar a la TopBar opaca
 * en los anchos donde se superponen.
 */
export function DashboardViewTabs({
  views,
  scope,
  workCount,
}: {
  views: DashboardView[]
  scope: DashboardScope
  /** Total de la cola, para la insignia de "Mi trabajo". `null` la omite. */
  workCount: number | null
}) {
  // Una sola vista no es un selector: es una etiqueta.
  if (views.length < 2) return null

  return (
    <nav
      aria-label="Vistas del tablero"
      className={cn(
        "sticky top-14 z-5 -mx-1 mb-5 flex gap-1 overflow-x-auto px-1",
        "border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur",
      )}
    >
      {views.map((view) => {
        const active = view.key === scope.view
        return (
          <Link
            key={view.key}
            href={dashboardScopeHref(scope, { view: view.key })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors",
              // Subrayado como pseudo-elemento y no como `border-b`: así no
              // desplaza medio píxel el texto al activarse.
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
              active
                ? "text-[var(--color-text)] after:bg-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] after:bg-transparent",
            )}
          >
            {view.title}
            {view.key === "trabajo" && workCount !== null && workCount > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                {workCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
