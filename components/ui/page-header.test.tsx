// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { PageHeader } from "./page-header"

vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/documentacion",
  // PageHeader usa useRouter para el atajo `n` (M-13).
  useRouter: () => ({ push: vi.fn() }),
}))

describe("PageHeader", () => {
  it("keeps the title, description and actions available on mobile while hiding the duplicate header on desktop", () => {
    const { container, getByRole, getByText } = render(
      <ShellHeaderProvider>
        <PageHeader
          title="Documentación"
          description="Biblioteca preventiva"
          actions={<button type="button">Nueva carpeta</button>}
        />
      </ShellHeaderProvider>,
    )

    expect(container.firstElementChild).toHaveClass("lg:sr-only")
    expect(getByRole("heading", { name: "Documentación" })).toBeDefined()
    expect(getByText("Biblioteca preventiva")).toBeDefined()
    expect(getByRole("button", { name: "Nueva carpeta" })).toBeDefined()
  })

  it("en móvil deja envolver también a las acciones que la página agrupa en su propio <div>", () => {
    // Diez páginas pasan `actions={<div className="flex items-center gap-2">…</div>}`.
    // Ese div no envolvía, así que a 390 px su fila de botones se salía del
    // pozo del shell (7 px en /prevencion/pdtp: "Nuevo programa" cortado).
    const { getByRole } = render(
      <ShellHeaderProvider>
        <PageHeader
          title="Programa de trabajo"
          actions={(
            <div className="flex items-center gap-2">
              <button type="button">Ver actividades</button>
              <button type="button">Nuevo programa</button>
            </div>
          )}
        />
      </ShellHeaderProvider>,
    )

    const mobileActions = getByRole("button", { name: "Nuevo programa" }).parentElement!.parentElement!
    expect(mobileActions).toHaveClass("lg:hidden")
    expect(mobileActions).toHaveClass("[&>div]:flex-wrap")
  })
})
