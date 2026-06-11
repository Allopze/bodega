"use client"

import * as React from "react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"

interface AppShellProps {
  session:        Session
  worksiteName?:  string
  badgeCounts?:   Record<string, number>
  children:       React.ReactNode
}

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed"
const SIDEBAR_COLLAPSED_EVENT = "sidebar-collapsed-change"

function getSidebarCollapsedSnapshot() {
  if (typeof window === "undefined") return false
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"
}

function subscribeSidebarCollapsed(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange)
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, onStoreChange)

  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, onStoreChange)
  }
}

export function AppShell({ session, worksiteName, badgeCounts, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [isClosing,  setIsClosing]  = React.useState(false)
  const sidebarCollapsed = React.useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    () => false,
  )

  function openDrawer()  { setMobileOpen(true);  setIsClosing(false) }
  function closeDrawer() {
    setIsClosing(true)
    setTimeout(() => { setMobileOpen(false); setIsClosing(false) }, 290)
  }
  function handleSidebarCollapsedChange(collapsed: boolean) {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT))
  }

  const showDrawer = mobileOpen || isClosing

  return (
    <div className="h-[100dvh] bg-[var(--color-bg)] p-0 lg:p-3 text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-(--radius) focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-(--shadow-md) focus:outline-2 focus:outline-primary"
      >
        Saltar al contenido
      </a>

      <div className="flex h-full min-h-0 lg:gap-3">
        <div className={cn(
          "hidden overflow-hidden bg-[var(--color-surface)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-drawer)]",
          "lg:flex lg:shrink-0 lg:flex-col lg:rounded-[var(--radius-2xl)] lg:shadow-[var(--shadow-card)]",
          sidebarCollapsed ? "lg:w-[4.75rem]" : "lg:w-60",
        )}>
          <Sidebar
            session={session}
            worksiteName={worksiteName}
            badgeCounts={badgeCounts}
            collapsed={sidebarCollapsed}
            onCollapsedChange={handleSidebarCollapsedChange}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-none bg-[var(--color-surface)] lg:rounded-[var(--radius-2xl)] lg:shadow-[var(--shadow-card)]">
          <TopBar
            session={session}
            onMenuToggle={() => mobileOpen ? closeDrawer() : openDrawer()}
            worksiteName={worksiteName}
            isMenuOpen={mobileOpen}
          />

          {/* Mobile drawer — fixed/viewport-relative, unaffected by panel overflow-hidden */}
          {showDrawer && (
            <>
              <div
                className={cn(
                  "fixed inset-0 z-40 lg:hidden",
                  "bg-overlay",
                  isClosing
                    ? "animate-out fade-out-0 duration-(--duration-slow)"
                    : "animate-in fade-in-0 duration-(--duration-slow)",
                )}
                onClick={closeDrawer}
                aria-hidden
              />
              <div className={cn(
                "fixed inset-y-0 left-0 z-50 w-64 lg:hidden bg-surface border-r border-[var(--color-border)]",
                isClosing
                  ? "animate-out slide-out-to-left duration-(--duration-slow) ease-drawer"
                  : "animate-in slide-in-from-left duration-(--duration-slow) ease-drawer",
              )}>
                <Sidebar session={session} worksiteName={worksiteName} badgeCounts={badgeCounts} />
              </div>
            </>
          )}

          {/* Main scrolls independently; panel stays fixed */}
          <main
            className="flex-1 min-w-0 overflow-y-auto bg-[var(--color-bg)]"
            id="main-content"
            tabIndex={-1}
          >
            <div className="px-4 md:px-8 py-6 max-w-360 mx-auto">
              {children}
            </div>
          </main>

        </div>
      </div>
    </div>
  )
}
