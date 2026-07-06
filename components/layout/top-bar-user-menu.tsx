"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldCheck, SignOut, UserCircle } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { signOut } from "next-auth/react"
import { Avatar } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

export function UserMenu({ session }: { session: AuthSession }) {
  const [isSigningOut, setIsSigningOut] = React.useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    await signOut({ redirect: false })
    window.location.href = "/login"
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) shrink-0 cursor-pointer"
          aria-label="Abrir menú de usuario"
        >
          <Avatar name={session.user.name ?? session.user.email ?? ""} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-(--color-text)">{session.user.name}</span>
            <span className="text-xs text-(--color-text-subtle) font-normal truncate max-w-[12rem]">{session.user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            href="/perfil"
            className="flex items-center gap-2 text-sm text-(--color-text) w-full cursor-pointer"
          >
            <UserCircle size={16} className="text-(--color-text-subtle)" />
            <span>Mi perfil</span>
          </Link>
        </DropdownMenuItem>
        {session.user.permissions?.some((p) => p.startsWith("admin:")) && (
          <DropdownMenuItem asChild>
            <Link
              href="/admin"
              className="flex items-center gap-2 text-sm text-(--color-text) w-full cursor-pointer"
            >
              <ShieldCheck size={16} className="text-(--color-text-subtle)" />
              <span>Administración</span>
            </Link>
          </DropdownMenuItem>
        )}
        {session.user.permissions?.some((p) => p.startsWith("admin:")) && <DropdownMenuSeparator />}
        <DropdownMenuItem asChild>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="flex w-full items-center gap-2 text-(--color-danger-ink) disabled:cursor-wait disabled:opacity-70"
          >
            <SignOut size={16} />
            <span>{isSigningOut ? "Cerrando..." : "Cerrar sesión"}</span>
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
