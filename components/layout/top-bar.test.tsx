// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { readFileSync } from "node:fs"
import { ShellHeaderProvider } from "./header-context"
import { TopBar } from "./top-bar"

let pathname = "/dashboard"

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  // `useSignOut` confirma contra el servidor que la sesión murió antes de salir.
  getSession: vi.fn(async () => null),
}))

vi.mock("./notification-bell", () => ({
  NotificationBell: () => <div aria-label="Notificaciones" />,
}))

function makeSession(permissions: string[] = []): Session {
  return {
    expires: "2026-12-31T00:00:00.000Z",
    user: {
      id: "user-1",
      name: "Admin Chome",
      email: "admin@chome.cl",
      roles: ["administrador"],
      permissions,
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      isGlobal: true,
    },
  }
}

describe("TopBar", () => {
  afterEach(() => {
    pathname = "/dashboard"
  })

  it("does not group dropdown menu items in an anonymous fragment", () => {
    const source = readFileSync("components/layout/sidebar-user-profile.tsx", "utf8")

    expect(source).not.toMatch(/session\.user\.permissions\?\.[\s\S]*?&&\s*\(\s*<>/)
  })

  it("keeps the generic header search on Documentación because its loaded list consumes the shared query", async () => {
    pathname = "/prevencion/documentacion"

    render(
      <ShellHeaderProvider>
        <TopBar session={makeSession()} onMenuToggle={vi.fn()} />
      </ShellHeaderProvider>,
    )

    expect(await screen.findByRole("searchbox", { name: "Filtrar en esta página" })).toBeInTheDocument()
  })
})
