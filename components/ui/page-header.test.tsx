// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { PageHeader } from "./page-header"

vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/documentacion",
}))

describe("PageHeader", () => {
  it("does not reserve a visible desktop spacer when actions are promoted to the shell header", () => {
    const { container } = render(
      <ShellHeaderProvider>
        <PageHeader title="Documentación" actions={<button type="button">Nueva carpeta</button>} />
      </ShellHeaderProvider>,
    )

    expect(container.firstElementChild).toHaveClass("lg:sr-only")
  })
})
