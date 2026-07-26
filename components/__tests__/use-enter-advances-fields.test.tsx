// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { useEnterAdvancesFields } from "@/lib/hooks/use-enter-advances-fields"

function Harness({ onSubmit }: { onSubmit?: () => void }) {
  const formRef = React.useRef<HTMLFormElement>(null)
  useEnterAdvancesFields(formRef)
  return (
    <form
      ref={formRef}
      onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}
    >
      <input aria-label="uno" />
      <textarea aria-label="notas" />
      <input aria-label="dos" />
      <input aria-label="tres" />
      <button type="submit">Enviar</button>
    </form>
  )
}

describe("useEnterAdvancesFields", () => {
  it("mueve el foco al siguiente campo en vez de enviar", () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const uno = screen.getByLabelText("uno")
    uno.focus()

    fireEvent.keyDown(uno, { key: "Enter" })

    expect(screen.getByLabelText("notas")).toHaveFocus()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("no intercepta Enter en un textarea: ahí significa salto de línea", () => {
    render(<Harness />)
    const notas = screen.getByLabelText("notas")
    notas.focus()

    fireEvent.keyDown(notas, { key: "Enter" })

    // el foco no se mueve
    expect(notas).toHaveFocus()
  })

  it("en el último campo conserva el envío nativo", () => {
    render(<Harness />)
    const tres = screen.getByLabelText("tres")
    tres.focus()

    // no hace preventDefault, así que el navegador enviaría
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    tres.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(false)
    expect(tres).toHaveFocus()
  })

  it("ignora Enter con modificadores para no pisar atajos del navegador", () => {
    render(<Harness />)
    const uno = screen.getByLabelText("uno")
    uno.focus()

    fireEvent.keyDown(uno, { key: "Enter", metaKey: true })

    expect(uno).toHaveFocus()
  })
})
