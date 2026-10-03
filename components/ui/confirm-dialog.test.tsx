// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "./confirm-dialog"

describe("ConfirmDialog", () => {
  it("con `error`, muestra el motivo dentro del diálogo como alerta", () => {
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Eliminar la medida" description="Se elimina." onConfirm={vi.fn()} error="La medida cambió mientras la editabas." />)
    expect(screen.getByRole("alert")).toHaveTextContent("La medida cambió mientras la editabas.")
  })
  it("sin `error` no hay alerta", () => {
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Eliminar la medida" description="Se elimina." onConfirm={vi.fn()} />)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
