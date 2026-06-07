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
  const [isCollapsed, setIsCollapsed] = React.useState(false)

  React.useEffect(() => {
    // Read the collapsed preference from localStorage after mounting to avoid hydration mismatch
    const saved = localStorage.getItem("sidebar-collapsed")
    if (saved === "true") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsCollapsed(true)
    }
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem("sidebar-collapsed", String(next))
      return next
    })
  }

  function openDrawer()  { setMobileOpen(true);  setIsClosing(false) }
  function closeDrawer() {
    setIsClosing(true)
    // Remove after slide-out finishes (--duration-slow = 300ms)
    setTimeout(() => { setMobileOpen(false); setIsClosing(false) }, 310)
  }

  const showDrawer = mobileOpen || isClosing

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-bg">
      {/* Skip link — connects to main-content below */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-(--radius) focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-(--shadow-md) focus:outline-2 focus:outline-primary"
      >
        Saltar al contenido
      </a>

      {/* ── Header full-width ── */}
      <TopBar
        session={session}
        onMenuToggle={() => mobileOpen ? closeDrawer() : openDrawer()}
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
        worksiteName={worksiteName}
      />

      {/* ── Body row: sidebar + content ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Desktop sidebar ── */}
        <div className={cn(
          "hidden lg:flex lg:flex-col lg:shrink-0 transition-all duration-300 ease-drawer",
          isCollapsed ? "lg:w-18" : "lg:w-64"
        )}>
          <Sidebar
            session={session}
            worksiteName={worksiteName}
            badgeCounts={badgeCounts}
            isCollapsed={isCollapsed}
            onToggleCollapse={toggleCollapse}
          />
        </div>

        {/* ── Mobile sidebar (drawer with enter + exit animations) ── */}
        {showDrawer && (
          <>
            {/* Overlay */}
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
            {/* Drawer */}
            <div className={cn(
              "fixed inset-y-0 left-0 z-50 w-64 lg:hidden",
              "shadow-(--shadow-lg)",
              isClosing
                ? "animate-out slide-out-to-left duration-(--duration-slow) ease-drawer"
                : "animate-in slide-in-from-left duration-(--duration-slow) ease-drawer",
            )}>
              <Sidebar session={session} worksiteName={worksiteName} badgeCounts={badgeCounts} />
            </div>
          </>
        )}

        {/* ── Main content ── */}
        <main
          className="flex-1 overflow-y-auto"
          id="main-content"
          tabIndex={-1}
        >
          <div className="px-4 md:px-6 py-5 max-w-350 mx-auto">
            {children}
          </div>
        </main>

      </div>
    </div>
  )
}
