// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
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
    const source = readFileSync("components/layout/top-bar.tsx", "utf8")

    expect(source).not.toMatch(/session\.user\.permissions\?\.[\s\S]*?&&\s*\(\s*<>/)
  })

  it("opens the admin user menu without React key warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      render(
        <ShellHeaderProvider>
          <TopBar session={makeSession(["admin:users"])} onMenuToggle={vi.fn()} />
        </ShellHeaderProvider>,
      )

      fireEvent.pointerDown(await screen.findByRole("button", { name: "Abrir menú de usuario" }), {
        button: 0,
        ctrlKey: false,
      })

      expect(screen.getByRole("menuitem", { name: /Administración/i })).toBeInTheDocument()
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Each child in a list should have a unique "key" prop.'),
        expect.anything(),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it("keeps the generic header search on Documentación because its loaded list consumes the shared query", async () => {
    pathname = "/prevencion/documentacion"

    render(
      <ShellHeaderProvider>
        <TopBar session={makeSession()} onMenuToggle={vi.fn()} />
      </ShellHeaderProvider>,
    )

    await screen.findByRole("button", { name: "Abrir menú de usuario" })
    expect(screen.getByRole("searchbox", { name: "Filtrar en esta página" })).toBeInTheDocument()
  })
})
