"use client"

import * as React from "react"
import Link from "next/link"
import * as Collapsible from "@radix-ui/react-collapsible"
import { CaretDown } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NAV_ICONS } from "./nav-icons"
import { isHrefActive, visibleHrefsOf, type AreaNode, type NavItem } from "./nav-items"

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-signal-tint px-1.5 py-0.5 font-mono text-2xs font-semibold tabular-nums text-signal-ink">
      {count > 99 ? "99+" : count}
    </span>
  )
}

const rowBase =
  "group relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) ease-out"

/**
 * Único tratamiento de selección de la navegación: verde suave (`nav-active-*`,
 * definidos en `@theme`) para CUALQUIER ítem activo —área, subítem, Inicio,
 * Soporte, flyout del rail y drawer móvil—. Antes convivían tres (píldora gris
 * pizarra, verde y sólo texto) y el usuario no podía leer "aquí estoy" igual en
 * dos lugares (auditoría UX-09, 2026-11-07).
 *
 * `ancestor` es la fila padre de un hijo activo: sin relleno —el relleno es sólo
 * del destino—, con el texto en tinta plena para marcar el camino.
 */
export function navRowClass(active: boolean, ancestor = false) {
  return cn(
    rowBase,
    active
      ? "bg-nav-active-bg font-semibold text-nav-active-ink"
      : ancestor
        ? "text-(--color-text) hover:bg-nav-hover-bg"
        : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
  )
}

/** Ícono de una fila de navegación; hereda `group-hover` de `navRowClass`. */
export function navIconClass(active: boolean, ancestor = false) {
  return cn(
    "shrink-0",
    active
      ? "text-(--color-primary)"
      : ancestor
        ? "text-(--color-text)"
        : "text-(--color-text-subtle) group-hover:text-(--color-text)",
  )
}

/** Misma regla para el rail colapsado, donde el ícono es el único rótulo. */
export function navRailClass(active: boolean) {
  return cn(
    "group relative flex items-center justify-center rounded-lg px-1 py-2 transition-colors duration-(--duration-fast) ease-out",
    active
      ? "bg-nav-active-bg text-nav-active-ink"
      : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
  )
}

/** Hoja (sin submenú). */
function LeafRow({
  item,
  pathname,
  visibleHrefs,
  count,
  onNavigate,
}: {
  item:         NavItem
  pathname:     string
  visibleHrefs: ReadonlySet<string>
  count:        number
  onNavigate?:  () => void
}) {
  const active = isHrefActive(item.href, pathname, visibleHrefs)
  const Icon = NAV_ICONS[item.iconName]
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-pressable
      className={navRowClass(active)}
    >
      {Icon && <Icon size={20} weight="regular" className={navIconClass(active)} />}
      <span title={item.label} className="flex-1 truncate">{item.label}</span>
      {count > 0 && <CountBadge count={count} />}
    </Link>
  )
}

/** Ítem con submenú (acordeón inline, auto-expandido si el route activo está dentro). */
function BranchRow({
  item,
  pathname,
  visibleHrefs,
  count,
  onNavigate,
}: {
  item:         NavItem
  pathname:     string
  visibleHrefs: ReadonlySet<string>
  count:        number
  onNavigate?:  () => void
}) {
  const Icon = NAV_ICONS[item.iconName]
  const selfActive  = isHrefActive(item.href, pathname, visibleHrefs)
  const childActive = (item.children ?? []).some((c) => isHrefActive(c.href, pathname, visibleHrefs))
  // `selfActive` por sí solo no basta: `NAV_PREFIX_OWNERS` (nav-items.ts)
  // solo conoce los hrefs del árbol de negocio, así que para ramas fuera de
  // ese árbol (p.ej. admin) `isHrefActive(item.href, ...)` da true incluso
  // viendo un hijo. `!childActive` evita marcar padre e hijo activos a la vez.
  const active = selfActive && !childActive
  const shouldOpen = selfActive || childActive
  // `defaultOpen` (manifiesto): los hijos se ven al cargar aunque la pantalla actual no sea del padre. Es sólo el
  // estado inicial; la persona puede plegarlo y no se vuelve a abrir solo hasta que la pantalla pase a ser suya.
  const [open, setOpen] = React.useState(shouldOpen || Boolean(item.defaultOpen))
  const [wasShouldOpen, setWasShouldOpen] = React.useState(shouldOpen)
  if (shouldOpen !== wasShouldOpen) {
    setWasShouldOpen(shouldOpen)
    if (shouldOpen) setOpen(true)
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      {/* `py-0`: la fila se estira por sus dos hijos (enlace y caret), que
          aportan el alto mínimo y su propio padding vertical; así el caret
          conserva un blanco de toque del alto completo de la fila. */}
      <div className={cn(navRowClass(active, childActive), "w-full py-0")}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          data-pressable
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-1.5 text-left"
        >
          {Icon && <Icon size={20} weight="regular" className={navIconClass(active, childActive)} />}
          <span title={item.label} className="flex-1 truncate">{item.label}</span>
          {count > 0 && <CountBadge count={count} />}
        </Link>
        <Collapsible.Trigger asChild>
          <button type="button" aria-label={`Mostrar destinos de ${item.label}`} aria-expanded={open} className="flex shrink-0 items-center self-stretch px-2 text-text-faint hover:text-(--color-text)">
          <CaretDown size={15} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
          </button>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <ul className="my-1 ml-3 space-y-1 border-l border-(--color-border) pl-2.5 py-0.5">
          {(item.children ?? []).map((child) => {
            const ca = isHrefActive(child.href, pathname, visibleHrefs)
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={ca ? "page" : undefined}
                  data-pressable
                  className={cn(
                    "flex min-h-9 items-center rounded-xl px-2.5 text-sm font-medium transition-colors duration-(--duration-fast) ease-out",
                    ca
                      ? "bg-nav-active-bg font-semibold text-nav-active-ink"
                      : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
                  )}
                >
                  <span title={child.label} className="truncate">{child.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/** Un ítem (o un hijo suyo) es la pantalla actual. */
function itemIsActive(item: NavItem, pathname: string, visibleHrefs: ReadonlySet<string>): boolean {
  return isHrefActive(item.href, pathname, visibleHrefs) || (item.children ?? []).some((child) => isHrefActive(child.href, pathname, visibleHrefs))
}

/** Los ítems de un área partidos en tramos consecutivos del mismo grupo (los sin grupo, en su propio tramo). */
function groupSections(items: NavItem[]): Array<{ group: string | null; items: NavItem[] }> {
  const sections: Array<{ group: string | null; items: NavItem[] }> = []
  for (const item of items) {
    const group = item.group ?? null
    const last = sections[sections.length - 1]
    if (last && last.group === group) last.items.push(item)
    else sections.push({ group, items: [item] })
  }
  return sections
}

/**
 * Un grupo del menú que se pliega bajo su rótulo (cajón móvil y panel de escritorio). Control operacional
 * mostraba sus 19 destinos de una vez (Seguimiento, Flota, Mantención, Combustible) y la pantalla actual
 * quedaba enterrada: en el móvil (crítica 2026-11-15, paso 7) y en escritorio (auditoría de encontrabilidad
 * 2026-11-26: a 1440×900 se veían 2 de los 7 ítems de Mantención sin desplazar el menú). El grupo de la
 * pantalla actual abre; los demás quedan plegados, y si traen pendientes su rótulo los suma para que nada
 * urgente se esconda.
 *
 * Mientras la persona no lo toque, el grupo sigue a la pantalla actual: abre cuando la contiene y se pliega
 * cuando la pantalla pasa a otro grupo, así el menú fijo de escritorio no va acumulando grupos abiertos. Uno
 * que la persona abrió o cerró a mano se queda como lo dejó, salvo que la pantalla pase a ser suya.
 */
function GroupDisclosure({ label, defaultOpen, pending, children }: { label: string; defaultOpen: boolean; pending: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen)
  const [touched, setTouched] = React.useState(false)
  const [wasDefaultOpen, setWasDefaultOpen] = React.useState(defaultOpen)
  if (defaultOpen !== wasDefaultOpen) {
    setWasDefaultOpen(defaultOpen)
    if (defaultOpen) {
      setOpen(true)
      setTouched(false)
    } else if (!touched) {
      setOpen(false)
    }
  }
  return (
    <Collapsible.Root open={open} onOpenChange={(next) => { setOpen(next); setTouched(true) }}>
      <Collapsible.Trigger asChild>
        {/* 44 px de alto en el teléfono (blanco de toque); 36 en escritorio, donde la altura del menú es lo escaso. */}
        <button
          type="button"
          aria-expanded={open}
          className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left hover:bg-nav-hover-bg focus-ring-inset lg:min-h-9"
        >
          <span className="text-eyebrow flex-1">{label}</span>
          {!open && pending > 0 && <CountBadge count={pending} />}
          <CaretDown size={14} aria-hidden className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <ul className="space-y-0.5">{children}</ul>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/**
 * Lista de ítems de un área (con acordeón para submenús). Reutilizada por el
 * panel desktop, el flyout del rail colapsado y el drawer móvil.
 *
 * `collapseInactiveGroups` (panel de escritorio, flyout del rail y cajón móvil): los grupos se pliegan
 * bajo su rótulo y abre el de la pantalla actual. Sin pantalla actual en el área, todos quedan abiertos.
 * Sin la prop, los grupos son rótulos fijos con todos sus destinos a la vista.
 */
const AreaItemsInner = React.memo(function AreaItemsInner({
  area,
  pathname,
  badgeCounts,
  onNavigate,
  collapseInactiveGroups = false,
}: {
  area:         AreaNode
  pathname:     string
  badgeCounts?: Record<string, number>
  onNavigate?:  () => void
  collapseInactiveGroups?: boolean
}) {
  const listRef = React.useRef<HTMLUListElement>(null)

  // El sidebar tiene su propio scroll. Al entrar a un detalle profundo se
  // centra la fila activa dentro de ese panel, sin desplazar el lienzo de la
  // pantalla ni obligar a recordar dónde quedó el módulo padre.
  React.useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>("[aria-current='page']")
    const scrollPanel = list?.closest<HTMLElement>("[data-nav-scroll]")
    if (!active || !scrollPanel) return

    const panel = scrollPanel.getBoundingClientRect()
    const target = active.getBoundingClientRect()
    const margin = 12
    if (target.top < panel.top + margin) {
      scrollPanel.scrollTop += target.top - panel.top - margin
    } else if (target.bottom > panel.bottom - margin) {
      scrollPanel.scrollTop += target.bottom - panel.bottom + margin
    }
  }, [pathname])

  // Lo que esta área muestra: para que un alias con comodín sólo valga donde se ve a su dueño (`isHrefActive`).
  const visibleHrefs = React.useMemo(() => visibleHrefsOf([area]), [area])
  const countOf = (item: NavItem) => (item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0)
  const row = (item: NavItem) => {
    const count = countOf(item)
    return item.children && item.children.length > 0
      ? <BranchRow item={item} pathname={pathname} visibleHrefs={visibleHrefs} count={count} onNavigate={onNavigate} />
      : <LeafRow   item={item} pathname={pathname} visibleHrefs={visibleHrefs} count={count} onNavigate={onNavigate} />
  }

  if (collapseInactiveGroups && area.items.some((item) => item.group)) {
    const sections = groupSections(area.items)
    const activeGroup = sections.find((section) => section.items.some((item) => itemIsActive(item, pathname, visibleHrefs)))?.group
    return (
      <ul ref={listRef} className="space-y-0.5">
        {sections.map((section) => section.group === null
          ? section.items.map((item) => <li key={item.href}>{row(item)}</li>)
          : (
            <li key={`grupo-${section.group}`}>
              <GroupDisclosure
                label={section.group}
                defaultOpen={activeGroup === undefined || activeGroup === section.group}
                pending={section.items.reduce((sum, item) => sum + countOf(item), 0)}
              >
                {section.items.map((item) => <li key={item.href}>{row(item)}</li>)}
              </GroupDisclosure>
            </li>
          ))}
      </ul>
    )
  }

  return (
    <ul ref={listRef} className="space-y-0.5">
      {area.items.map((item, index) => {
        const showGroupHeader = item.group && item.group !== area.items[index - 1]?.group
        return (
          <React.Fragment key={item.href}>
            {showGroupHeader && (
              <li className="text-eyebrow mt-6 mb-2 px-3 first:mt-1" aria-hidden="true">
                {item.group}
              </li>
            )}
            <li>{row(item)}</li>
          </React.Fragment>
        )
      })}
    </ul>
  )
})

export const AreaItems = AreaItemsInner
