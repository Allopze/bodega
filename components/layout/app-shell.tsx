"use client"

import * as React from "react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { useHideOnScroll } from "@/lib/hooks/use-hide-on-scroll"
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

const AppShellInner = React.memo(function AppShellInner({ session, worksiteName, badgeCounts, enabledModuleIds, children }: AppShellProps) {
  // Convertir a Set para lookup eficiente en getVisibleAreas
  const enabledSet = React.useMemo(
    () => (enabledModuleIds ? new Set(enabledModuleIds) : undefined),
    [enabledModuleIds],
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
  const mainRef = React.useRef<HTMLElement>(null)
  const headerHidden = useHideOnScroll(mainRef)

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
        />

        <ShellHeaderProvider>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
                  />
                </div>
              </>
            )}

            {/* Pozo blanco: contenido al ras, esquina sup-izq redondeada en desktop.
                overflow-y-auto crea el scroll container y el clip del radio. */}
            <main
              ref={mainRef}
              className="flex-1 min-w-0 overflow-y-auto bg-(--color-surface) lg:rounded-tl-(--radius-xl)"
              id="main-content"
              tabIndex={-1}
            >
              {/* TopBar sticky dentro del pozo — se mantiene al top mientras el
                  contenido scrollea. En desktop, lg: overrides bloquean el auto-hide. */}
              <TopBar
                session={session}
                onMenuToggle={mobileOpen ? closeDrawer : openDrawer}
                worksiteName={worksiteName}
                isMenuOpen={mobileOpen}
                hidden={headerHidden}
                className="sticky top-0 z-10"
              />
              {children}
            </main>
          </div>
        </ShellHeaderProvider>
      </div>

      {/* Paleta de comandos global (⌘K / Ctrl+K) — lazy load */}
      <React.Suspense fallback={null}>
        <CommandPalette session={session} enabledModuleIds={enabledModuleIds} />
      </React.Suspense>
    </div>
  )
})

export const AppShell = AppShellInner
