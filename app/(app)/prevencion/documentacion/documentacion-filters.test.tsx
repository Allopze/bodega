// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { DocumentacionFilters } from "./documentacion-filters"

afterEach(() => {
  cleanup()
  push.mockReset()
})

describe("DocumentacionFilters", () => {
  it("uses URL filters on the server route and preserves the current folder", () => {
    const { rerender } = render(
      <DocumentacionFilters
        query={{ folder: "folder-1" }}
        categories={[{ slug: "gestion_preventiva", name: "Gestión preventiva" }]}
        worksites={[{ id: "worksite-1", name: "Faena Norte" }]}
        total={75}
        page={1}
        pageSize={50}
      />,
    )

    fireEvent.change(screen.getByRole("textbox", { name: "Buscar documentos" }), { target: { value: "procedimiento" } })
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "gestion_preventiva" } })
    fireEvent.change(screen.getByLabelText("Faena"), { target: { value: "worksite-1" } })
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))

    expect(push).toHaveBeenLastCalledWith("/prevencion/documentacion?q=procedimiento&category=gestion_preventiva&worksiteId=worksite-1&folder=folder-1")

    rerender(
      <DocumentacionFilters
        query={{ q: "procedimiento", category: "gestion_preventiva", worksiteId: "worksite-1", folder: "folder-1" }}
        categories={[{ slug: "gestion_preventiva", name: "Gestión preventiva" }]}
        worksites={[{ id: "worksite-1", name: "Faena Norte" }]}
        total={75}
        page={1}
        pageSize={50}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    expect(push).toHaveBeenLastCalledWith("/prevencion/documentacion?q=procedimiento&category=gestion_preventiva&worksiteId=worksite-1&page=2&folder=folder-1")
  })
})
