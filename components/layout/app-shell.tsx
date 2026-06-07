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

  function openDrawer()  { setMobileOpen(true);  setIsClosing(false) }
  function closeDrawer() {
    setIsClosing(true)
    // Remove after slide-out finishes (--duration-slow = 300ms)
    setTimeout(() => { setMobileOpen(false); setIsClosing(false) }, 310)
  }

  const showDrawer = mobileOpen || isClosing

  return (
    <div className="flex min-h-[100dvh] overflow-hidden bg-[var(--color-bg)]">
      {/* Skip link — connects to main-content below */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[var(--radius)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-md)] focus:outline-2 focus:outline-[var(--color-primary)]"
      >
        Saltar al contenido
      </a>

      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col">
        <Sidebar session={session} worksiteName={worksiteName} badgeCounts={badgeCounts} />
      </div>

      {/* ── Mobile sidebar (drawer with enter + exit animations) ── */}
      {showDrawer && (
        <>
          {/* Overlay */}
          <div
            className={cn(
              "fixed inset-0 z-40 lg:hidden",
              "bg-[var(--color-overlay)]",
              isClosing
                ? "animate-out fade-out-0 duration-[var(--duration-slow)]"
                : "animate-in fade-in-0 duration-[var(--duration-slow)]",
            )}
            onClick={closeDrawer}
            aria-hidden
          />
          {/* Drawer */}
          <div className={cn(
            "fixed inset-y-0 left-0 z-50 w-64 lg:hidden",
            "shadow-[var(--shadow-lg)]",
            isClosing
              ? "animate-out slide-out-to-left duration-[var(--duration-slow)] ease-[var(--ease-drawer)]"
              : "animate-in slide-in-from-left duration-[var(--duration-slow)] ease-[var(--ease-drawer)]",
          )}>
            <Sidebar session={session} worksiteName={worksiteName} badgeCounts={badgeCounts} />
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          session={session}
          onMenuToggle={() => mobileOpen ? closeDrawer() : openDrawer()}
        />
        <main
          className="flex-1 overflow-y-auto"
          id="main-content"
          tabIndex={-1}
        >
          <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
