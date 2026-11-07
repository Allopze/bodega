"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { List, MagnifyingGlass, MapPin, X } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { cn } from "@/lib/utils"
import { BrandMark } from "./brand-mark"
import { useHasWorksiteFilter, useSafeShellHeader, useShellHeader } from "./header-context"

const NotificationBell = React.lazy(() =>
  import("./notification-bell").then((m) => ({ default: m.NotificationBell }))
)

interface TopBarProps {
  session:       AuthSession
  onMenuToggle:  () => void
  className?:    string
  isMenuOpen?:   boolean
  worksiteName?: string
}

// `/combustibles`: las superficies de trabajo tienen su propio buscador
// rotulado (Cargas, Por revisar, Facturas, Archivos, Vehículos, Proveedores).
// Al ocultar el de la shell en todo el módulo, una DataTable sin `search`
// propio se quedaba sin filtro; si se agrega una tabla nueva, tiene que traerlo.
//
// `/entregas` (BOD-01, auditoría 2026-10-05): el historial está paginado en el
// servidor, así que el input de la shell sólo filtraba las 25 filas en pantalla
// y un trabajador de la página 3 daba "Sin entregas". La búsqueda es `?q=` y se
// resuelve en SQL (`entregas/delivery-filters.tsx`).
//
// `/admin/taxonomia-sst` está aquí por el otro motivo que documenta
// `search-architecture`: la pantalla muestra **dos** tablas (categorías y
// tipos). El input de la shell sólo puede alimentar a una, así que convivía
// con un "Buscar categorías..." local y el usuario no tenía cómo saber a cuál
// de las dos apuntaba cada caja. Cada tabla trae ahora su propio buscador
// rotulado.
// Combustible filtra todo en el servidor (período, faena y, donde hay texto,
// su propio buscador rotulado: Cargas, Por revisar, Facturas, Archivos), así que
// la shell no muestra el suyo en ninguna pantalla del módulo.
// Mantención de equipos: `/mantencion/registros` (lista y detalle) filtra en SQL con
// `recordVisibilitySql` y sus filtros viven en la URL, así que el input de la shell
// sólo filtraría las 25 filas de la página. `/mantencion/panel` es una portada de
// indicadores sin colección que filtrar (mismo criterio que `/dashboard`).
// `/prevencion/capacitacion`: la lista de actividades combina mes, estado y texto, y
// el input de la shell no dice cuál de esos filtros alimenta; la lista trae su propio
// buscador rotulado (pulido UI/UX 2026-11-07). Quien quite el input propio de esa
// lista tiene que devolver esta ruta a la shell, o la pantalla queda sin búsqueda.
const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion", "/pendientes", "/entregas", "/bodega", "/flota", "/soporte", "/prevencion/ppa", "/prevencion/inspecciones", "/prevencion/pdtp/obligaciones", "/facturacion/facturas", "/seguimiento", "/ti/accesos", "/ti/tickets", "/admin/taxonomia-sst", "/combustibles", "/mantencion/registros", "/mantencion/panel", "/mantencion/ot", "/prevencion/capacitacion"]

/** Formularios de alta/edición: no hay lista que filtrar, así que el input de
 *  la shell prometería un filtrado inexistente. Ninguna ruta bajo estos
 *  segmentos consume `useSafeShellHeader` ni renderiza un `DataTable`. */
const FORM_ROUTE = /\/(editar|nuevo|crear)(\/|$)/

/** En el espacio de trabajo de una MIPER la matriz y el programa tienen
 *  buscadores propios y rotulados: la regla de búsqueda pide ocultar el de la
 *  shell. La portada, el catálogo y la ficha de control lo conservan. */
const OWN_SEARCH_PATTERNS = [
  /^\/prevencion\/miper\/(?!factores(?:\/|$)|controles(?:\/|$))[^/]+$/,
  // Portadas sin una colección filtrable: el índice de módulos y los indicadores
  // de facturación son enlaces o métricas, no listas.
  /^\/prevencion$/,
  /^\/facturacion$/,
  // TI (TIUX-35): el resumen, los reportes y la ficha de un activo no tienen
  // lista que filtrar; el input de la shell prometía un filtrado que no existe.
  // Las listas `/ti/activos` y `/ti/licencias` lo conservan. `/ti/tickets` (y su
  // ficha) está en ROUTES_WITH_OWN_SEARCH: la mesa de ayuda busca en servidor.
  /^\/ti$/,
  /^\/ti\/reportes$/,
  /^\/ti\/activos\/[^/]+$/,
  // Mantención: «Importar» es una carga de archivo y la ficha de un equipo no
  // tiene lista que la shell pueda filtrar. La lista `/mantencion/equipos` lo conserva.
  /^\/mantencion\/equipos\/[^/]+$/,
]

/**
 * Inicio (`/dashboard`) no tiene ninguna lista que el filtro de la shell pueda
 * alimentar: la cola de trabajo se fue a `/pendientes` (que busca en servidor) y
 * lo que queda son tiles, gráficos y enlaces. TRV-04 (auditoría 2026-10-05): el
 * input aparecía en las 9 vistas y escribir no hacía nada. Se oculta en toda la
 * ruta, sin sondear `?vista=`.
 */
export function hidesShellSearch(pathname: string) {
  if (pathname === "/dashboard") return true
  return ROUTES_WITH_OWN_SEARCH.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || OWN_SEARCH_PATTERNS.some((pattern) => pattern.test(pathname))
    || FORM_ROUTE.test(pathname)
}

const TopBarInner = React.memo(function TopBarInner({
  onMenuToggle,
  className,
  isMenuOpen = false,
  worksiteName,
}: TopBarProps) {
  const pathname = usePathname()
  const { header } = useShellHeader()
  const hasWorksiteFilter = useHasWorksiteFilter()
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

  // Clear search on navigation.
  React.useEffect(() => {
    setSearchQuery("")
  }, [pathname, setSearchQuery])

  // These routes have their own per-screen search bar (URL-synced,
  // server-side). The top-bar in-memory search is inert there — hide it so
  // users don't see two search inputs with different behaviours.
  const hideSearch = hidesShellSearch(pathname)

  return (
    <>
    <header className={cn(
      // 4.5rem en desktop y no 3.5: el pozo redondea 36px la esquina superior
      // izquierda, así que con 56px de alto el título se centraba a 28px —dentro
      // de la curva— y toda la fila quedaba pegada al borde. A 72px el centro
      // cae justo en los 36px del radio y la fila respira por arriba y por abajo.
      // Móvil no tiene pozo ni curva: se queda en 3.5rem.
      // `min-h` y no `h` en desktop: las acciones ahora envuelven (ver su
      // contenedor) y con alto fijo una segunda fila se montaba sobre el
      // contenido. En el caso normal, una sola fila, mide lo mismo que antes.
      "flex items-center h-[3.5rem] lg:h-auto lg:min-h-[4.5rem] lg:py-2 px-4 md:px-6 gap-3",
      // Sin fondo propio: la barra scrollea con el contenido (no es `sticky`),
      // así que hereda el del `<main>` y con él la sombra `inset` del pozo —
      // header y zona de trabajo quedan indistinguibles, sin costura ni
      // franja sin sombra. Un fondo opaco aquí rompía las dos cosas.
      "border-b border-(--color-border) lg:border-b-0",
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
        {/* `min-w-32`: las acciones de abajo ahora pueden encogerse, y sin un
            piso el título (`flex-1`, base 0) era lo primero en quedarse en
            cero. Con el piso el título se trunca pero sigue leyéndose. */}
        <div className="min-w-32 flex-1">
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
              <div aria-hidden="true" className="flex min-w-0 flex-col">
                {/* Heading destacado al inicio de la vista. Exo 600, como el
                    <h1> del PageHeader móvil (auditoría UX-15, 2026-11-07: el
                    700 queda sólo para la marca). `leading-snug` y no el
                    1.55 del cuerpo: con la descripción debajo, el bloque de
                    dos líneas cabe en el `min-h` del header sin estirarlo.
                    El `max-w` cubre el caso patológico de un título larguísimo. */}
                <p title={header.title} className="max-w-[min(36rem,100%)] truncate font-display text-lg font-semibold leading-snug text-(--color-text)">
                  {header.title}
                </p>
                {/* Va debajo del título y no a su lado (auditoría UX-11,
                    2026-11-07): en la misma fila compartía ancho con el título,
                    el chip de faena, hasta 3 botones y el buscador, y a 1440px
                    terminaba en «…» justo donde estaba el dato que responde
                    «qué es esto». Dos líneas, con un tope de ~72 caracteres por
                    línea para que no se estire en pantallas anchas.
                    Estaba en `2xl:block`, así que en un laptop de 1440 se perdían
                    los conteos de contexto ("N ítems en M solicitudes") y pistas
                    como "…y fija los precios" en compras/nueva (A-11). */}
                {header.description && (
                  <p title={header.description} className="hidden min-w-0 max-w-[72ch] line-clamp-2 text-xs leading-snug text-(--color-text-muted) lg:block">
                    {header.description}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        {/* Es la faena de la sesión, no un filtro de la vista. Sin la etiqueta se
            leía como "estoy viendo sólo esta faena" en páginas que listan varias
            (Bodega agrupa por faena y la de la sesión puede no aparecer).
            Con un selector de faena en la vista se oculta: aun rotulado, "Tu
            faena: Oficina Central" junto a un filtro en Masisa se leía como
            "la pantalla no cambió", y el selector ya dice qué faena se ve. */}
        {worksiteName && !hasWorksiteFilter && (
          <div
            title={`Tu faena: ${worksiteName}`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-(--radius) bg-(--color-surface-2) border border-(--color-border)"
          >
            <MapPin size={13} weight="bold" className="text-(--color-primary) shrink-0" aria-hidden />
            <span className="text-xs font-medium text-(--color-text-muted) truncate max-w-[16rem] 2xl:max-w-[20rem]">
              <span className="text-(--color-text-subtle)">Tu faena: </span>
              {worksiteName}
            </span>
          </div>
        )}
        {/* `min-w-0` + `flex-wrap`, no `shrink-0`: a 1024 px (sidebar
            abierto) las métricas de Bodega + su CTA medían 646 px y la fila se
            salía 59 px del pozo, que recortaba el botón. Ahora la tira de
            métricas envuelve en dos líneas dentro de la altura del TopBar y el
            CTA —que no se parte— conserva su ancho. */}
        {header.actions && (
          <div className="hidden min-w-0 flex-wrap items-center justify-end gap-1.5 lg:flex">
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
    </>
  )
})

export const TopBar = TopBarInner
