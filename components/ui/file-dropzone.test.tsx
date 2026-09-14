// @vitest-environment jsdom

/**
 * El dropzone se operaba sólo con mouse: era un <div onClick> y el input estaba en
 * `tabIndex={-1}`, de modo que quien navega con teclado no tenía ningún punto de
 * tabulación que abriera el selector de archivos. Lo que se fija acá es que el input
 * sea alcanzable y tenga nombre accesible, y que el botón decorativo no vuelva a
 * aparecer en el orden de tabulación como control inerte.
 */

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FileDropzone } from "./file-dropzone"

describe("FileDropzone · operable con teclado", () => {
  it("expone el input de archivo con nombre accesible y en el orden de tabulación", () => {
    render(<FileDropzone onFileSelect={() => {}} title="Sube tu planilla" />)

    const input = screen.getByLabelText(/Sube tu planilla/i)
    expect(input).toHaveAttribute("type", "file")
    expect(input).not.toHaveAttribute("tabindex")
  })

  it("asocia la etiqueta visible al input mediante htmlFor/id", () => {
    const { container } = render(<FileDropzone onFileSelect={() => {}} id="planilla" />)

    const label = container.querySelector("label")
    expect(label).toHaveAttribute("for", "planilla")
    expect(container.querySelector("#planilla")).toHaveProperty("tagName", "INPUT")
  })

  it("deja el botón decorativo fuera del orden de tabulación", () => {
    render(<FileDropzone onFileSelect={() => {}} acceptLabel="Archivos Excel" />)

    // aria-hidden lo saca del árbol accesible, así que no debe tener nombre accesible.
    expect(screen.queryByRole("button", { name: /Archivos Excel/i })).toBeNull()
  })
})
