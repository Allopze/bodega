// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { AppShell } from "./app-shell"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}))

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  getSession: vi.fn(async () => null),
}))

// El sujeto de esta prueba es la estructura que arma `AppShell` alrededor de la
// TopBar, así que la TopBar va REAL y sus vecinos mockeados: montar la
// navegación entera o la paleta de comandos (un `React.lazy`) sólo añadiría
// ruido asíncrono sin cambiar ni un nodo de lo que se assertea.
vi.mock("./desktop-nav", () => ({
  DesktopNav: () => <nav aria-label="Navegación" />,
}))
vi.mock("./mobile-nav", () => ({
  MobileNav: () => <div />,
}))
vi.mock("./notification-bell", () => ({
  NotificationBell: () => <button type="button" aria-label="Notificaciones" />,
}))
vi.mock("./command-palette", () => ({
  CommandPalette: () => null,
}))

function makeSession(): Session {
  return {
    expires: "2026-12-31T00:00:00.000Z",
    user: {
      id: "user-1",
      name: "Admin Chome",
      email: "admin@chome.cl",
      roles: ["administrador"],
      permissions: [],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      isGlobal: true,
    },
  }
}

/** Las clases que hacen del pozo lo que es. Ver el comentario en `app-shell.tsx`. */
const CLASES_DEL_POZO = [
  "relative",
  "overflow-y-auto",
  "overflow-x-hidden",
  "lg:rounded-tl-[36px]",
  "lg:shadow-well",
] as const

/**
 * `AppShell` monta la paleta de comandos con `React.lazy`, así que el primer
 * render del archivo suspende y el árbol llega en un tick posterior: sin
 * esperarlo, la primera prueba que corriera veía un body vacío y las demás
 * pasaban por casualidad (el módulo ya estaba resuelto).
 */
async function montar() {
  const utils = render(
    <AppShell session={makeSession()}>
      <p>contenido centinela de la página</p>
    </AppShell>,
  )
  await screen.findByRole("main")
  return utils
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AppShell — landmarks", () => {
  it("expone un landmark banner", async () => {
    await montar()
    // Antes de este contrato `banner` no existía en ninguna ruta: la TopBar se
    // montaba dentro de `<main>`, y un `<header>` descendiente de `main` pierde
    // la correspondencia implícita con el rol.
    expect(screen.getByRole("banner")).toBeTruthy()
  })

  it("el banner es un landmark de primer nivel", async () => {
    await montar()
    const banner = screen.getByRole("banner")
    // Exactamente el defecto que este cambio arregla. `[role]` incluido: un
    // ancestro con rol explícito anidaría el banner igual que un `<main>`.
    expect(banner.closest("main, nav, aside, article, section, [role]")).toBeNull()
  })

  it("main contiene la página y no el cromo del shell", async () => {
    await montar()
    const main = screen.getByRole("main")
    expect(main.contains(screen.getByRole("banner"))).toBe(false)
    expect(main).toContainElement(screen.getByText("contenido centinela de la página"))
    // El skip link apunta acá, así que el id y el foco viajan con `<main>`.
    expect(main.id).toBe("main-content")
    expect(main.getAttribute("tabindex")).toBe("-1")
  })

  it("el skip link sigue apuntando al contenido principal", async () => {
    await montar()
    expect(screen.getByRole("link", { name: "Saltar al contenido" }))
      .toHaveAttribute("href", "#main-content")
  })
})

describe("AppShell — el pozo es el contenedor de scroll, y main va desnudo", () => {
  it("el pozo conserva las clases que lo definen", async () => {
    const { container } = await montar()
    const pozo = container.querySelector("[data-shell-scroll]")
    expect(pozo).not.toBeNull()
    for (const clase of CLASES_DEL_POZO) {
      expect(pozo!.className).toContain(clase)
    }
  })

  it("main no lleva ninguna clase", async () => {
    await montar()
    // No es minimalismo: es corrección. Cinco modales artesanales con
    // `fixed inset-0` dentro de las páginas se anclan al viewport, y el
    // `sticky top-0` del detalle de inspección resuelve contra el pozo. Un
    // `transform`, `filter`, `contain` u `overflow` en `<main>` lo volvería
    // bloque contenedor de esos `fixed` —modales encajados y recortados— y
    // rompería el sticky. Cualquier clase acá es la puerta de entrada a eso.
    expect(screen.getByRole("main").getAttribute("class")).toBeNull()
  })

  it("el banner vive dentro del pozo, para seguir scrolleando con el contenido", async () => {
    const { container } = await montar()
    const pozo = container.querySelector("[data-shell-scroll]")
    // Si alguien saca la cabecera del pozo para hacerla fija, deja de heredar
    // el fondo y la sombra `inset`, que es lo que la mantiene sin costura.
    expect(pozo!.contains(screen.getByRole("banner"))).toBe(true)
    expect(pozo!.firstElementChild).toBe(screen.getByRole("banner"))
  })
})
