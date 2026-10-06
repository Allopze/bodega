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
 * Dos niveles. `Resumen` es el **modo de mirar** por defecto (el bloque "Hoy" y
 * el panorama); las áreas son **lugares**. "Mi trabajo" ya no es una pestaña: la
 * cola vive en `/pendientes` y su resumen en "Hoy". Las áreas viven en un
 * desplegable que, con una activa, dice **qué es y cuál está elegida**
 * ("Por área: Bodega") y lleva `aria-current`; antes decía sólo "Bodega" y no
 * se leía como un selector. Cada ítem trae una línea que explica qué cifras
 * contiene, porque los nombres solos no bastan para elegir.
 *
 * El desplegable dice "Por área" y no "Dominio": `dominio` es la palabra del
 * código (`dashboard-domains.ts`), no la del usuario. Ojo: "área" aquí es sólo
 * "agrupación por tema". Los rótulos de cada vista siguen al sidebar donde el
 * contenido mapea (Control operacional, Bodega, Prevención…) y el cuadro de
 * `dashboard-domains.ts` documenta cuáles son y cuáles no — el comentario
 * anterior afirmaba que las vistas ya coincidían con `components/layout/
 * areas.ts` y no era cierto (INI-09).
 *
 * No es `sticky`: era la segunda capa pegada del pozo y su fondo `--color-bg`
 * con `backdrop-blur` dejaba una franja gris sobre el blanco del `<main>`.
 */
export function DashboardViewTabs({
  views,
  scope,
}: {
  views: DashboardView[]
  scope: DashboardScope
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
        </Tab>
      ))}

      {domains.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-current={activeDomain ? "page" : undefined}
            className={cn(tabClassName(Boolean(activeDomain)), "gap-1")}
          >
            {activeDomain ? `Por área: ${activeDomain.title}` : "Por área"}
            <CaretDown size={13} weight="bold" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {domains.map((view) => (
              <DropdownMenuItem key={view.key} asChild>
                <Link
                  href={dashboardScopeHref(scope, { view: view.key })}
                  aria-current={view.key === scope.view ? "page" : undefined}
                  className="flex flex-col items-start gap-0.5 py-2"
                >
                  <span className="text-sm font-semibold">{view.title}</span>
                  <span className="text-xs font-normal leading-4 text-[var(--color-text-muted)]">{view.description}</span>
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
