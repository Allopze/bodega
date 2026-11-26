// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { readFileSync } from "node:fs"
import { consumePendingOpen, OPEN_COMMAND_PALETTE_EVENT } from "./command-palette-events"
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
// El lanzador pide sus recientes con react-query; aquí sólo importa que exista.
vi.mock("./app-launcher", () => ({
  AppLauncher: () => <button type="button" aria-label="Apps" />,
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

  describe("botón «Ir a…» (paleta de comandos)", () => {
    function renderTopBar() {
      return render(
        <ShellHeaderProvider>
          <TopBar session={makeSession()} onMenuToggle={vi.fn()} />
        </ShellHeaderProvider>,
      )
    }
    afterEach(() => { consumePendingOpen() })

    it("es un botón visible con nombre accesible, atajo anunciado y la pista «Ctrl K»", () => {
      renderTopBar()
      const boton = screen.getByRole("button", { name: "Ir a…" })
      expect(boton.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K")
      expect(boton.getAttribute("title")).toBe("Ir a una página o a un folio (atajo: Ctrl K)")
      expect(within(boton).getByText("Ctrl K")).toBeInTheDocument()
      // En el teléfono es sólo el ícono (44 px de blanco de toque): el rótulo queda para el lector de pantalla.
      expect(boton.className).toContain("min-h-[44px]")
      expect(within(boton).getByText("Ir a…").className).toContain("sr-only")
    })

    it("no se confunde con el filtro de la página: otro rótulo, otro control", async () => {
      pathname = "/prevencion/documentacion"
      renderTopBar()
      const filtro = await screen.findByRole("searchbox", { name: "Filtrar en esta página" })
      const boton = screen.getByRole("button", { name: "Ir a…" })
      expect(boton).not.toBe(filtro)
      expect(boton.getAttribute("aria-label")).not.toBe(filtro.getAttribute("aria-label"))
      expect(screen.queryByRole("button", { name: /Filtrar/ })).not.toBeInTheDocument()
    })

    it("está también donde la shell no ofrece filtro (Inicio, el resolvedor de folios)", () => {
      for (const ruta of ["/dashboard", "/mantencion/ir"]) {
        pathname = ruta
        const view = renderTopBar()
        expect(screen.queryByRole("searchbox", { name: "Filtrar en esta página" }), ruta).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Ir a…" }), ruta).toBeInTheDocument()
        view.unmount()
      }
    })

    it("al pulsarlo dispara el evento que abre la paleta", () => {
      const alAbrir = vi.fn()
      window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, alAbrir)
      try {
        renderTopBar()
        fireEvent.click(screen.getByRole("button", { name: "Ir a…" }))
        expect(alAbrir).toHaveBeenCalledTimes(1)
      } finally {
        window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, alAbrir)
      }
    })

    it("si la paleta aún no cargó (React.lazy), la petición queda anotada para cuando monte", () => {
      renderTopBar()
      fireEvent.click(screen.getByRole("button", { name: "Ir a…" }))
      expect(consumePendingOpen()).toBe(true)
      expect(consumePendingOpen()).toBe(false)
    })
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
