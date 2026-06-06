"use client"

import * as React from "react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"

interface AppShellProps {
  session:       Session
  worksiteName?: string
  children:      React.ReactNode
}

export function AppShell({ session, worksiteName, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // Close sidebar on outside click (mobile)
  const handleOverlayClick = React.useCallback(() => setMobileOpen(false), [])

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col">
        <Sidebar session={session} worksiteName={worksiteName} />
      </div>

      {/* ── Mobile sidebar (drawer) ── */}
      {mobileOpen && (
        <>
          {/* Overlay */}
          <div
            className={cn(
              "fixed inset-0 z-40 bg-[oklch(0.20_0.01_155/0.40)]",
              "lg:hidden",
            )}
            onClick={handleOverlayClick}
            aria-hidden
          />
          {/* Drawer */}
          <div className={cn(
            "fixed inset-y-0 left-0 z-50 w-64 lg:hidden",
            "shadow-[4px_0_20px_oklch(0_0_0/0.15)]",
            // Slide-in from left — ease-drawer per Emil
            "animate-in slide-in-from-left duration-[var(--duration-slow)]",
          )}>
            <Sidebar session={session} worksiteName={worksiteName} />
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          session={session}
          onMenuToggle={() => setMobileOpen((v) => !v)}
        />
        <main
          className="flex-1 overflow-y-auto"
          id="main-content"
        >
          <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
