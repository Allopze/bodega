// @vitest-environment jsdom
import * as React from "react"
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet"

function Harness({ kind }: { kind: "dialog" | "sheet" }) {
  const [open, setOpen] = React.useState(false)
  const Root = kind === "dialog" ? Dialog : Sheet
  const Content = kind === "dialog" ? DialogContent : SheetContent
  const Title = kind === "dialog" ? DialogTitle : SheetTitle
  const Desc = kind === "dialog" ? DialogDescription : SheetDescription
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <Root open={open} onOpenChange={setOpen}>
        <Content>
          <Title>Título</Title>
          <Desc>Descripción</Desc>
          <input aria-label="Campo" />
        </Content>
      </Root>
    </>
  )
}

describe.each(["dialog", "sheet"] as const)("retorno de foco (%s) sin Trigger de Radix", (kind) => {
  afterEach(cleanup)

  it("devuelve el foco al botón propio al cerrar con Escape", async () => {
    render(<Harness kind={kind} />)
    const button = screen.getByRole("button", { name: "Abrir" })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole("dialog")
    expect(document.activeElement).not.toBe(button)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})

/* "Más acciones → Corregir estado…": el ítem que tenía el foco desaparece al
 * cerrarse el menú, así que el foco debe volver al botón que abrió el menú. El
 * menú se simula con la misma rotulación que usa Radix (`aria-labelledby` del
 * contenido = id del botón disparador). */
function MenuHarness() {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" id="menu-trigger" onClick={() => setMenuOpen(true)}>Más acciones</button>
      {menuOpen && (
        <div role="menu" aria-labelledby="menu-trigger">
          <button type="button" role="menuitem" onClick={() => { setOpen(true); setTimeout(() => setMenuOpen(false), 0) }}>
            Corregir estado
          </button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Corregir estado</DialogTitle>
          <DialogDescription>Descripción</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  )
}

describe("retorno de foco desde un ítem de menú", () => {
  afterEach(cleanup)

  it("vuelve al botón que abrió el menú, no al ítem que ya no existe", async () => {
    render(<MenuHarness />)
    const trigger = screen.getByRole("button", { name: "Más acciones" })
    fireEvent.click(trigger)
    const item = screen.getByRole("menuitem", { name: "Corregir estado" })
    item.focus()
    fireEvent.click(item)
    await screen.findByRole("dialog")
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(document.activeElement).toBe(trigger)
  })
})
