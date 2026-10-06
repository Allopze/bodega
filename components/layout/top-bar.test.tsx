// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { readFileSync } from "node:fs"
import { ShellHeaderProvider, useWorksiteFilterPresence } from "./header-context"
import { TopBar } from "./top-bar"

let pathname = "/dashboard"
let search = ""

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
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
    search = ""
  })

  // TRV-04: el input sólo se ofrece donde algo lo consume. Inicio ya no tiene
  // ninguna lista (la cola vive en /pendientes), así que ninguna vista lo lleva.
  it("Inicio: oculta el filtro de la shell en todas las vistas", async () => {
    for (const vista of ["resumen", "finanzas", "adquisiciones"]) {
      search = `vista=${vista}`
      const view = render(
        <ShellHeaderProvider>
          <TopBar session={makeSession()} onMenuToggle={vi.fn()} />
        </ShellHeaderProvider>,
      )
      expect(screen.queryByRole("searchbox", { name: "Filtrar en esta página" }), vista).not.toBeInTheDocument()
      view.unmount()
    }
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

  describe("chip de la faena de sesión", () => {
    function FaenaFilter({ active = true }: { active?: boolean }) {
      useWorksiteFilterPresence(active)
      return null
    }

    function Shell({ children }: { children?: React.ReactNode }) {
      return (
        <ShellHeaderProvider>
          <TopBar session={makeSession()} onMenuToggle={vi.fn()} worksiteName="Oficina Central" />
          {children}
        </ShellHeaderProvider>
      )
    }

    it("se muestra en una vista sin selector de faena", () => {
      render(<Shell />)
      expect(screen.getByText("Oficina Central")).toBeInTheDocument()
    })

    // Al lado de un filtro en Masisa, "Tu faena: Oficina Central" se leía
    // como "la pantalla no cambió".
    it("se oculta mientras la vista tiene un selector de faena y vuelve al quitarlo", () => {
      const view = render(<Shell><FaenaFilter /></Shell>)
      expect(screen.queryByText("Oficina Central")).not.toBeInTheDocument()

      view.rerender(<Shell />)
      expect(screen.getByText("Oficina Central")).toBeInTheDocument()
    })

    it("no se oculta cuando el filtro declara que no muestra el selector", () => {
      render(<Shell><FaenaFilter active={false} /></Shell>)
      expect(screen.getByText("Oficina Central")).toBeInTheDocument()
    })

    it("sigue oculto mientras quede al menos un selector montado", () => {
      const view = render(<Shell><FaenaFilter /><FaenaFilter /></Shell>)
      view.rerender(<Shell><FaenaFilter /></Shell>)
      expect(screen.queryByText("Oficina Central")).not.toBeInTheDocument()
    })
  })
})
