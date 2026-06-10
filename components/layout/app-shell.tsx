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

export function AppShell({ session, worksiteName, badgeCounts, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [isClosing,  setIsClosing]  = React.useState(false)

  React.useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed")
    if (saved !== null) return
  }, [])

  function openDrawer()  { setMobileOpen(true);  setIsClosing(false) }
  function closeDrawer() {
    setIsClosing(true)
    setTimeout(() => { setMobileOpen(false); setIsClosing(false) }, 290)
  }

  const showDrawer = mobileOpen || isClosing

  return (
    <div className="min-h-[100dvh] bg-bg text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-(--radius) focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-(--shadow-md) focus:outline-2 focus:outline-primary"
      >
        Saltar al contenido
      </a>

      <TopBar
        session={session}
        onMenuToggle={() => mobileOpen ? closeDrawer() : openDrawer()}
        worksiteName={worksiteName}
        isMenuOpen={mobileOpen}
      />

      <div className="flex min-h-[calc(100dvh-3.25rem)]">

        {/* Desktop rail — flat surface, no dark panel, no shadow */}
        <div className="hidden lg:sticky lg:top-[3.25rem] lg:flex lg:h-[calc(100dvh-3.25rem)] lg:flex-col lg:shrink-0 bg-surface border-r border-[var(--color-border)] lg:w-60">
          <Sidebar
            session={session}
            worksiteName={worksiteName}
            badgeCounts={badgeCounts}
          />
        </div>

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

        <main
          className="flex-1 min-w-0 bg-bg"
          id="main-content"
          tabIndex={-1}
        >
          <div className="px-4 md:px-8 py-6 max-w-360 mx-auto min-h-full">
            {children}
          </div>
        </main>

      </div>
    </div>
  )
}
