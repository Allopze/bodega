// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkPhoto } from "./work-photo"

afterEach(cleanup)

const THUMB = { name: "Ampliar la foto de respaldo de KA-143 del 12-11-2026" }

function open() {
  render(<WorkPhoto photoId="5a0e2c1d-7b3f-4e8a-9c61-aa1d00000001" alt="KA-143 del 12-11-2026" />)
  const thumb = screen.getByRole("button", THUMB)
  thumb.focus()
  fireEvent.click(thumb)
  return thumb
}

describe("WorkPhoto · visor de la foto de una correctiva", () => {
  it("el título del visor se ve en una fila propia: el botón de cierre no queda sobre la foto", () => {
    open()
    const dialog = screen.getByRole("dialog", { name: "Foto de respaldo de KA-143 del 12-11-2026" })
    const title = screen.getByRole("heading", { name: "Foto de respaldo de KA-143 del 12-11-2026" })
    expect(title.className).not.toContain("sr-only")
    // La fila del título (donde cae el botón de cierre) precede a la imagen en el diálogo.
    const image = screen.getByRole("img", { name: "Foto de respaldo de KA-143 del 12-11-2026" })
    expect(dialog.contains(image)).toBe(true)
    expect(title.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("Escape cierra el visor y el foco vuelve a la miniatura", async () => {
    const thumb = open()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(thumb))
  })

  it("el botón Cerrar cierra el visor y el foco vuelve a la miniatura", async () => {
    const thumb = open()
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(thumb))
  })
})

describe("WorkPhoto · respaldo de un trabajo", () => {
  it("un formulario con enlace de respaldo lo ofrece en otra pestaña y no filtra la fila al abrirlo", () => {
    const onRow = vi.fn()
    render(<div onClick={onRow}><WorkPhoto photoId={null} photoUrl="https://drive.example/foto" alt="KA-143 del 12-11-2026" /></div>)
    const link = screen.getByRole("link", { name: /Ver foto/ })
    expect(link.getAttribute("href")).toBe("https://drive.example/foto")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toContain("noopener")
    fireEvent.click(link)
    expect(onRow).not.toHaveBeenCalled()
  })

  it("«Sin foto» en aviso lleva ícono y texto; el neutro es sólo texto", () => {
    const { container, rerender } = render(<WorkPhoto photoId={null} alt="KA-143" missingTone="warn" />)
    expect(screen.getByText("Sin foto").className).toContain("text-[var(--color-warning-ink)]")
    expect(container.querySelector("svg")).toBeTruthy()
    rerender(<WorkPhoto photoId={null} alt="KA-143" />)
    expect(screen.getByText("Sin foto").className).not.toContain("text-[var(--color-warning-ink)]")
    expect(container.querySelector("svg")).toBeNull()
  })
})
