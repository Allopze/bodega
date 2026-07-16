// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { PageHeader } from "./page-header"

vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/documentacion",
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
})
