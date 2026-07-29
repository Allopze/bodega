// @vitest-environment jsdom

import { render, fireEvent, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FileInput } from "./file-input"

describe("FileInput", () => {
  it("renders a hidden native input with the given name/accept/required, and no visible native file button", () => {
    const { container } = render(<FileInput name="file" accept=".xlsx" required />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveClass("sr-only")
    expect(input.name).toBe("file")
    expect(input.accept).toBe(".xlsx")
    expect(input.required).toBe(true)

    const scoped = within(container)
    expect(scoped.getByText("Ningún archivo seleccionado")).toBeInTheDocument()
    expect(scoped.getByRole("button", { name: /seleccionar archivo/i })).toBeInTheDocument()
  })

  it("shows the selected filename and calls onChange when a file is picked", () => {
    const onChange = vi.fn()
    const { container } = render(<FileInput onChange={onChange} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    const file = new File(["contenido"], "factura.pdf", { type: "application/pdf" })
    fireEvent.change(input, { target: { files: [file] } })

    expect(within(container).getByText("factura.pdf")).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith(file)
  })

  it("clicking the styled button forwards the click to the hidden input", () => {
    const { container } = render(<FileInput />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, "click")

    fireEvent.click(within(container).getByRole("button", { name: /seleccionar archivo/i }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it("has a fallback aria-label only when there's no id for an external <Field label> to target", () => {
    const withoutId = render(<FileInput name="file" />)
    const inputWithoutId = withoutId.container.querySelector('input[type="file"]') as HTMLInputElement
    expect(inputWithoutId).toHaveAttribute("aria-label", "Seleccionar archivo")

    const withId = render(<FileInput id="product-import-file" name="file" />)
    const inputWithId = withId.container.querySelector('input[type="file"]') as HTMLInputElement
    expect(inputWithId).not.toHaveAttribute("aria-label")
  })
})
