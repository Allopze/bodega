"use client"

import Link from "next/link"
import { CaretDown } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { dashboardScopeHref, type DashboardScope } from "./dashboard-scope"
import { isDomainView, type DashboardView } from "./dashboard-views"

/**
 * El selector del tablero: **qué se quiere mirar**.
 *
 * Reemplaza a `DomainIndex`, que eran anclas `#dominio-*` sobre una página que
 * ya tenía las seis secciones montadas: navegaba con scroll, no conmutaba nada.
 * Estas son `<Link>` a `?vista=`, así que cada una es un render de servidor con
 * sus propias consultas y ninguna otra.
 *
 * Dos taxonomías, dos niveles. `Resumen` y `Mi trabajo` son **modos de mirar**;
 * los dominios son **lugares**. Con los nueve como pestañas hermanas había que
 * leerlas todas para descubrir que no eran comparables, y ocupaban una banda
 * entera. Los dominios viven ahora en un desplegable que se rotula con el
 * activo, así que la vista actual sigue siendo legible sin abrirlo.
 *
 * El desplegable dice "Por área" y no "Dominio": `dominio` es la palabra del
 * código (`dashboard-domains.ts`), no la del usuario — `components/layout/areas.ts`
 * ya llama **áreas** a estas mismas agrupaciones y son los iconos del rail, así
 * que es la palabra que el usuario tiene delante todo el día.
 *
 * No es `sticky`: era la segunda capa pegada del pozo y su fondo `--color-bg`
 * con `backdrop-blur` dejaba una franja gris sobre el blanco del `<main>`.
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

  const modes = views.filter((view) => !isDomainView(view.key))
  const domains = views.filter((view) => isDomainView(view.key))
  const activeDomain = domains.find((view) => view.key === scope.view)

  return (
    <nav aria-label="Vistas del tablero" className="-mx-1 flex min-w-0 items-stretch gap-1 overflow-x-auto px-1">
      {modes.map((view) => (
        <Tab key={view.key} href={dashboardScopeHref(scope, { view: view.key })} active={view.key === scope.view}>
          {view.title}
          {view.key === "trabajo" && workCount !== null && workCount > 0 && (
            <span className="ml-1.5 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
              {workCount}
            </span>
          )}
        </Tab>
      ))}

      {domains.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(tabClassName(Boolean(activeDomain)), "gap-1")}>
            {activeDomain?.title ?? "Por área"}
            <CaretDown size={13} weight="bold" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {domains.map((view) => (
              <DropdownMenuItem key={view.key} asChild>
                <Link
                  href={dashboardScopeHref(scope, { view: view.key })}
                  aria-current={view.key === scope.view ? "page" : undefined}
                >
                  {view.title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  )
}

/**
 * El subrayado es pseudo-elemento y no `border-b`: así no desplaza medio píxel
 * el texto al activarse. Compartido entre las pestañas y el disparador del
 * desplegable para que el dominio activo se lea como una pestaña más.
 */
function tabClassName(active: boolean) {
  return cn(
    "relative flex shrink-0 items-center whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors",
    "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
    active
      ? "text-[var(--color-text)] after:bg-[var(--color-primary)]"
      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] after:bg-transparent",
  )
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={tabClassName(active)}>
      {children}
    </Link>
  )
}
