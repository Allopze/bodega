// @vitest-environment jsdom
import { useState } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Combobox } from "./combobox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog"

const OPTIONS = ["Corte de metales", "Gestión documental"].map((value) => ({ value, label: value }))

function Harness({ onOpenChange, first = "combobox" }: { onOpenChange: (open: boolean) => void; first?: "combobox" | "input" }) {
  const [value, setValue] = useState("Gestión documental")
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Editar tarea</DialogTitle>
        <DialogDescription>Cambia la actividad.</DialogDescription>
        {first === "input" && <input aria-label="Nombre" />}
        <Combobox aria-label="Actividad" options={OPTIONS} value={value} onChange={setValue} allowCustomValue />
      </DialogContent>
    </Dialog>
  )
}

describe("Dialog con un combobox", () => {
  it("si el primer control es un combobox, el foco va al diálogo y la lista no se abre sola", () => {
    render(<Harness onOpenChange={vi.fn()} />)
    expect(screen.getByRole("dialog", { name: "Editar tarea" })).toHaveFocus()
    expect(screen.getByRole("combobox", { name: "Actividad" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("con otro control primero, el autofoco de Radix sigue igual", () => {
    render(<Harness onOpenChange={vi.fn()} first="input" />)
    expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveFocus()
  })

  it("Escape con la lista abierta cierra la lista; la siguiente cierra el diálogo", () => {
    const onOpenChange = vi.fn()
    render(<Harness onOpenChange={onOpenChange} />)
    const combobox = screen.getByRole("combobox", { name: "Actividad" })
    act(() => combobox.focus())
    expect(combobox).toHaveAttribute("aria-expanded", "true")
    fireEvent.keyDown(combobox, { key: "Escape" })
    expect(combobox).toHaveAttribute("aria-expanded", "false")
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.keyDown(combobox, { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
