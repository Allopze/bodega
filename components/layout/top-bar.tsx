"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { List, MagnifyingGlass, MapPin, X } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { cn } from "@/lib/utils"
import { BrandMark } from "./brand-mark"
import { useSafeShellHeader, useShellHeader } from "./header-context"

const NotificationBell = React.lazy(() =>
  import("./notification-bell").then((m) => ({ default: m.NotificationBell }))
)

interface TopBarProps {
  session:       AuthSession
  onMenuToggle:  () => void
  className?:    string
  isMenuOpen?:   boolean
  worksiteName?: string
  /** When true, slides the bar out of view above the viewport clip. */
  hidden?:       boolean
}

// `/combustibles` no construye ningún input propio en ninguna de sus
// subrutas — estaba en esta lista sin que nada lo alimentara, así que sus
// tablas basadas en DataTable (vehículos, proveedores) quedaban sin buscador.
const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion", "/pendientes", "/prevencion/ppa", "/facturacion/facturas", "/trazabilidad/documento"]

/** Formularios de alta/edición: no hay lista que filtrar, así que el input de
 *  la shell prometería un filtrado inexistente. Ninguna ruta bajo estos
 *  segmentos consume `useSafeShellHeader` ni renderiza un `DataTable`. */
const FORM_ROUTE = /\/(editar|nuevo|crear)(\/|$)/

const TopBarInner = React.memo(function TopBarInner({
  onMenuToggle,
  className,
  isMenuOpen = false,
  worksiteName,
  hidden = false,
}: TopBarProps) {
  const pathname = usePathname()
  const { header } = useShellHeader()
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  const searchRef = React.useRef<HTMLInputElement>(null)

  // M-13: "/" enfoca el filtro de la página, el atajo estándar de los backoffice.
  // No dispara mientras se escribe en otro control, ni con modificadores (para no
  // pisar los atajos del navegador).
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!searchRef.current) return
      event.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Clear search on navigation
  React.useEffect(() => {
    setSearchQuery("")
  }, [pathname, setSearchQuery])

  // These routes have their own per-screen search bar (URL-synced,
  // server-side). The top-bar in-memory search is inert there — hide it so
  // users don't see two search inputs with different behaviours.
  const hideSearch = ROUTES_WITH_OWN_SEARCH.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || FORM_ROUTE.test(pathname)

  return (
    <header className={cn(
      "flex items-center h-[3.5rem] px-4 md:px-6 gap-3",
      // Opaca también en desktop: la barra es `sticky` dentro del pozo de
      // scroll, así que con fondo transparente el contenido se veía POR DEBAJO
      // del título y las migas al scrollear (texto sobre texto). El color es el
      // mismo del `<main>`, así que al tope del scroll se ve idéntica.
      "bg-(--color-surface) border-b border-(--color-border) lg:border-b-0",
      // Auto-hide on mobile: slide out above the sticky clip, fade to 0.
      // Desktop: always visible (lg: overrides hide regardless of scroll).
      "transition-[transform,opacity] duration-(--duration-default) ease-(--ease-out)",
      hidden
        ? "-translate-y-full opacity-0 pointer-events-none lg:translate-y-0 lg:opacity-100 lg:pointer-events-auto"
        : "translate-y-0 opacity-100",
      className,
    )}>
      <div className="flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={onMenuToggle}
          className={cn(
            "lg:hidden flex items-center justify-center",
            "min-h-[44px] min-w-[44px] rounded-(--radius-lg)",
            "text-(--color-text-muted) hover:text-(--color-text)",
            "hover:bg-(--color-surface-2)",
            "transition-[color,background-color] duration-(--duration-fast)",
          )}
          aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={isMenuOpen}
        >
          <List size={18} weight="bold" />
        </button>

        <BrandMark variant="light" size={32} subtitle titleSize="base" />
      </div>

      {/* Desktop: contexto de página + chip de faena (si aplica) */}
      <div className="flex-1 min-w-0 hidden lg:flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {header.title && (
            <div className="flex min-w-0 flex-col">
              {/* El breadcrumb sólo existía en el bloque local del `PageHeader`,
                  que es `lg:sr-only`: las páginas lo construían y en desktop no se
                  dibujaba en ninguna parte (auditoría UI/UX 2026-07-29, A-12). */}
              {header.breadcrumb && (
                <div className="hidden min-w-0 truncate xl:block">{header.breadcrumb}</div>
              )}
              {/* Eco visual del PageHeader, que en `lg` queda `sr-only` pero
                  sigue en el árbol de accesibilidad con su <h1> y su
                  descripción. Sin `aria-hidden` el lector anuncia el título y
                  la descripción de la página dos veces en escritorio. */}
              <div aria-hidden="true" className="flex min-w-0 items-baseline gap-2">
                {/* Heading destacado al inicio de la vista. `shrink-0`: el
                    título no cede espacio ante la descripción — sin esto, una
                    descripción larga lo truncaba a "Pendientes de f…" incluso
                    a 1920px (auditoría UI/UX 2026-08-05, A3). El `max-w` cubre
                    el caso patológico de un título larguísimo sin descripción. */}
                <p title={header.title} className="max-w-[36rem] shrink-0 truncate text-lg font-bold tracking-tight text-(--color-text)">
                  {header.title}
                </p>
                {/* Estaba en `2xl:block`, así que en un laptop de 1440 se perdían
                    los conteos de contexto ("N ítems en M solicitudes") y pistas
                    como "…y fija los precios" en compras/nueva (A-11). */}
                {header.description && (
                  <p title={header.description} className="hidden min-w-0 truncate text-xs text-(--color-text-muted) lg:block">
                    {header.description}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        {worksiteName && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-(--radius) bg-(--color-surface-2) border border-(--color-border)">
            <MapPin size={13} weight="bold" className="text-(--color-primary) shrink-0" />
            <span className="text-xs font-medium text-(--color-text-muted) truncate max-w-[16rem] 2xl:max-w-[20rem]">
              {worksiteName}
            </span>
          </div>
        )}
        {header.actions && (
          <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
            {header.actions}
          </div>
        )}
      </div>
      {/* Mobile: spacer para empujar campana+avatar a la derecha */}
      <div className="flex-1 lg:hidden" aria-hidden />

      <div className="flex items-center gap-1.5">
        {!hideSearch && (
          <div className="relative hidden sm:flex items-center">
            <MagnifyingGlass size={14} className="absolute left-2.5 text-(--color-text-subtle) pointer-events-none shrink-0" />
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                // Esc limpia y devuelve el foco al contenido.
                if (e.key === "Escape") { setSearchQuery(""); e.currentTarget.blur() }
              }}
              placeholder="Filtrar en esta página..."
              title="Filtrar en esta página (atajo: /)"
              className={cn(
                "h-[34px] w-36 lg:w-56 rounded-[var(--radius-md)] border bg-(--color-surface) pl-8 text-xs font-medium text-(--color-text) placeholder:text-(--color-text-subtle) outline-none focus:border-(--color-primary) focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-primary)_35%,transparent)] transition-[border-color,box-shadow] duration-(--duration-fast)",
                searchQuery
                  ? "border-(--color-primary-line) pr-7"
                  : "border-(--color-border-control) pr-3",
              )}
              aria-label="Filtrar en esta página"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-(--color-text-subtle) hover:bg-surface-3 hover:text-(--color-text) transition-colors duration-(--duration-fast)"
                aria-label="Limpiar filtro"
              >
                <X size={11} weight="bold" />
              </button>
            )}
          </div>
        )}
        <NotificationBell />
      </div>
    </header>
  )
})

export const TopBar = TopBarInner
