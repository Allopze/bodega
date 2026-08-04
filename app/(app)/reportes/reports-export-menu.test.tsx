// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ReportsExportMenu } from "./reports-export-menu"

vi.mock("@/components/export-dialog", () => ({
  ExportDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}))

describe("ReportsExportMenu", () => {
  it("keeps the four Excel reports behind one page-level entry point", () => {
    render(<ReportsExportMenu worksites={[{ id: "ws-1", name: "Faena Norte" }]} />)

    fireEvent.pointerDown(screen.getByRole("button", { name: "Exportar Excel" }), { button: 0, ctrlKey: false })

    expect(screen.getByText("Elige el informe a exportar")).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Ítems sin OC" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Gasto por faena" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "OC cerradas sin factura" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "OC por estado" })).toBeInTheDocument()
  })
})
