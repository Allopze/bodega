"use client"

import * as React from "react"
import Link from "next/link"
import type { Session } from "next-auth"
import { SignOut } from "@phosphor-icons/react"
import { signOut } from "next-auth/react"
import { Avatar } from "@/components/ui/avatar"
import { Tooltip } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

interface SidebarUserProfileProps {
  session: Session
  collapsed?: boolean
}

/**
 * Perfil de usuario anclado al fondo de la sidebar.
 *
 * - Expandido: avatar + nombre + email (con dropdown de acciones)
 * - Colapsado (rail): solo avatar con tooltip
 */
const SidebarUserProfileInner = React.memo(function SidebarUserProfileInner({
  session,
  collapsed = false,
}: SidebarUserProfileProps) {
  const [isSigningOut, setIsSigningOut] = React.useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    await signOut({ redirect: false })
    window.location.href = "/login"
  }

  const name = session.user.name ?? session.user.email ?? ""
  const email = session.user.email ?? ""

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-(--color-border) py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) cursor-pointer"
              aria-label="Abrir menú de usuario"
            >
              <Tooltip content={name} side="right" delayDuration={250}>
                <span><Avatar name={name} size="sm" /></span>
              </Tooltip>
            </button>
          </DropdownMenuTrigger>
          <UserDropdownContent
            session={session}
            isSigningOut={isSigningOut}
            onSignOut={handleSignOut}
          />
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="border-t border-(--color-border) px-3 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-(--radius) px-1 py-1.5 text-left transition-colors duration-(--duration-fast) hover:bg-(--color-chrome-hover) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) cursor-pointer"
            aria-label="Abrir menú de usuario"
          >
            <Avatar name={name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-(--color-text) leading-tight">{name}</p>
              <p className="truncate text-xs text-(--color-text-subtle) leading-tight">{email}</p>
            </div>
          </button>
        </DropdownMenuTrigger>
        <UserDropdownContent
          session={session}
          isSigningOut={isSigningOut}
          onSignOut={handleSignOut}
        />
      </DropdownMenu>
    </div>
  )
})

function UserDropdownContent({
  session,
  isSigningOut,
  onSignOut,
}: {
  session: Session
  isSigningOut: boolean
  onSignOut: () => void
}) {
  return (
    <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-[13rem]">
      <DropdownMenuLabel>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-(--color-text)">{session.user.name}</span>
          <span
            title={session.user.email ?? undefined}
            className="text-xs text-(--color-text-subtle) font-normal truncate max-w-[12rem]"
          >
            {session.user.email}
          </span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link
          href="/perfil"
          className="flex items-center gap-2 text-sm text-(--color-text) w-full cursor-pointer"
        >
          Mi perfil
        </Link>
      </DropdownMenuItem>
      {session.user.permissions?.some((p) => p.startsWith("admin:")) && (
        <DropdownMenuItem asChild>
          <Link
            href="/admin"
            className="flex items-center gap-2 text-sm text-(--color-text) w-full cursor-pointer"
          >
            Administración
          </Link>
        </DropdownMenuItem>
      )}
      {session.user.permissions?.some((p) => p.startsWith("admin:")) && <DropdownMenuSeparator />}
      <DropdownMenuItem asChild>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="flex w-full items-center gap-2 text-(--color-danger-ink) disabled:cursor-wait disabled:opacity-70"
        >
          <SignOut size={16} />
          <span>{isSigningOut ? "Cerrando..." : "Cerrar sesión"}</span>
        </button>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

export const SidebarUserProfile = SidebarUserProfileInner
