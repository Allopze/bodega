"use client"

import * as React from "react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { DesktopNav } from "./desktop-nav"
import { MobileNav } from "./mobile-nav"
import { TopBar } from "./top-bar"
import { ShellHeaderProvider } from "./header-context"

const CommandPalette = React.lazy(() =>
  import("./command-palette").then((m) => ({ default: m.CommandPalette }))
)

interface AppShellProps {
  session:           Session
  worksiteName?:     string
  badgeCounts?:      Record<string, number>
  /** Módulos habilitados por feature toggle. */
  enabledModuleIds?: string[]
  disabledSubmoduleHrefs?: string[]
  children:          React.ReactNode
}

const PANEL_COLLAPSED_KEY = "sidebar-collapsed"
const PANEL_COLLAPSED_EVENT = "sidebar-collapsed-change"

function getPanelCollapsedSnapshot() {
  if (typeof window === "undefined") return false
  return localStorage.getItem(PANEL_COLLAPSED_KEY) === "true"
}

function subscribePanelCollapsed(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange)
  window.addEventListener(PANEL_COLLAPSED_EVENT, onStoreChange)
  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener(PANEL_COLLAPSED_EVENT, onStoreChange)
  }
}

const AppShellInner = React.memo(function AppShellInner({ session, worksiteName, badgeCounts, enabledModuleIds, disabledSubmoduleHrefs, children }: AppShellProps) {
  // Convertir a Set para lookup eficiente en getVisibleAreas
  const enabledSet = React.useMemo(
    () => (enabledModuleIds ? new Set(enabledModuleIds) : undefined),
    [enabledModuleIds],
  )
  const disabledSubmoduleSet = React.useMemo(
    () => (disabledSubmoduleHrefs ? new Set(disabledSubmoduleHrefs) : undefined),
    [disabledSubmoduleHrefs],
  )
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [isClosing,  setIsClosing]  = React.useState(false)
  const panelCollapsed = React.useSyncExternalStore(
    subscribePanelCollapsed,
    getPanelCollapsedSnapshot,
    () => false,
  )

  const openDrawer = React.useCallback(() => { setMobileOpen(true); setIsClosing(false) }, [])
  const closeDrawer = React.useCallback(() => {
    setIsClosing(true)
    setTimeout(() => { setMobileOpen(false); setIsClosing(false) }, 290)
  }, [])
  const handlePanelCollapsedChange = React.useCallback((collapsed: boolean) => {
    localStorage.setItem(PANEL_COLLAPSED_KEY, String(collapsed))
    window.dispatchEvent(new Event(PANEL_COLLAPSED_EVENT))
  }, [])

  const showDrawer = mobileOpen || isClosing

  return (
    <div className="h-[100dvh] bg-(--color-chrome) text-text overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-(--radius) focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-(--shadow-md) focus:outline-2 focus:outline-primary"
      >
        Saltar al contenido
      </a>

      <div className="flex h-full min-h-0">
        {/* Desktop: sidebar flush, parte izquierda de la L tintada */}
        <DesktopNav
          session={session}
          badgeCounts={badgeCounts}
          collapsed={panelCollapsed}
          onCollapsedChange={handlePanelCollapsedChange}
          enabledModuleIds={enabledSet}
          disabledSubmoduleHrefs={disabledSubmoduleSet}
        />

        <ShellHeaderProvider>
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">

            {/* Mobile drawer — acordeón de columna única */}
            {showDrawer && (
              <>
                <div
                  className={cn(
                    "fixed inset-0 z-40 lg:hidden bg-overlay",
                    isClosing
                      ? "animate-out fade-out-0 duration-(--duration-slow)"
                      : "animate-in fade-in-0 duration-(--duration-slow)",
                  )}
                  onClick={closeDrawer}
                  aria-hidden
                />
                <div className={cn(
                  "fixed inset-y-0 left-0 z-50 w-64 lg:hidden bg-(--color-chrome) border-r border-(--color-border)",
                  isClosing
                    ? "animate-out slide-out-to-left duration-(--duration-slow) ease-drawer"
                    : "animate-in slide-in-from-left duration-(--duration-slow) ease-drawer",
                )}>
                  <MobileNav
                    session={session}
                    worksiteName={worksiteName}
                    badgeCounts={badgeCounts}
                    onNavigate={closeDrawer}
                    enabledModuleIds={enabledSet}
                    disabledSubmoduleHrefs={disabledSubmoduleSet}
                  />
                </div>
              </>
            )}

            {/* Pozo blanco: contenido al ras, esquina sup-izq redondeada en desktop.
                overflow-y-auto crea el scroll container y el clip del radio. */}
            {/* A-7: salvaguarda contra scroll horizontal (WCAG 1.4.10 Reflow).
                `relative` es imprescindible: sin él, un descendiente `absolute`
                toma el <html> como bloque contenedor y escapa al recorte —fue
                exactamente lo que pasó con un `.sr-only` dentro de una tabla
                ancha—. `overflow-x-hidden` (no `clip`, que aquí no generaba CSS)
                contiene el resto. Las tablas anchas no se ven afectadas: siguen
                desplazándose dentro de su propio `TableRoot`. */}
            {/* Este nodo era el `<main>`. Dejó de serlo —conservando clases,
                comentarios y su lugar exacto en el DOM— porque la TopBar vivía
                dentro de él, y un `<header>` descendiente de `main` pierde la
                correspondencia implícita con el rol `banner`: la aplicación no
                exponía ningún landmark de cabecera, y todo el cromo global
                —buscador, notificaciones, menú de usuario, faena— quedaba dentro
                del landmark del contenido de la página.

                Renombrarlo y no moverlo es lo que hace el cambio seguro: el
                contenedor de scroll sigue siendo este punto del DOM, así que
                todo `sticky top-0` y todo `scroll-mt-*` de las páginas resuelve
                contra el mismo scrollport, y la TopBar sigue dentro de él. */}
            <div
              data-shell-scroll
              className="relative flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[var(--color-surface)] lg:rounded-tl-[36px] lg:shadow-well"
            >
              {/* La TopBar scrollea con el contenido: nada se queda pegado
                  dentro del pozo. Sin `sticky` tampoco necesita fondo opaco,
                  y sin fondo opaco la sombra `inset` del pozo la cruza.
                  Es además el `banner`: por eso está acá y no dentro de
                  `<main>`. No la vuelvas `sticky` ni le des fondo propio. */}
              <TopBar
                session={session}
                onMenuToggle={mobileOpen ? closeDrawer : openDrawer}
                worksiteName={worksiteName}
                isMenuOpen={mobileOpen}
              />
              {/* `<main>` va SIN CLASES, y no es minimalismo: es corrección.
                  Dentro de `{children}` hay modales artesanales con
                  `fixed inset-0` que se anclan al viewport (combustibles/tae,
                  ti/activos, prevencion/documentacion, admin/folios) y el
                  `sticky top-0` del detalle de inspección, que resuelve contra
                  el pozo. Un `transform`, `filter`, `contain`, `will-change`,
                  `perspective` u `overflow` acá volvería a `<main>` bloque
                  contenedor de esos `fixed` —modales encajados y recortados— y
                  rompería el sticky. `components/layout/app-shell.test.tsx`
                  congela que este elemento no tenga `className`.

                  El `id` y el `tabIndex` viajan con él: el skip link apunta a
                  `#main-content` y ahora aterriza DESPUÉS del banner, que es lo
                  que un skip link promete y antes no cumplía. */}
              <main id="main-content" tabIndex={-1}>{children}</main>
            </div>
          </div>
        </ShellHeaderProvider>
      </div>

      {/* Paleta de comandos global (⌘K / Ctrl+K) — lazy load */}
      <React.Suspense fallback={null}>
        <CommandPalette
          session={session}
          enabledModuleIds={enabledModuleIds}
          disabledSubmoduleHrefs={disabledSubmoduleHrefs}
        />
      </React.Suspense>
    </div>
  )
})

export const AppShell = AppShellInner
