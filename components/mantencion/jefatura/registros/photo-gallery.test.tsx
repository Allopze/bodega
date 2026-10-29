// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PhotoGallery } from "./photo-gallery"
import type { LightboxPhoto } from "./photo-lightbox"

const photos: LightboxPhoto[] = [
  { id: "p1", caption: "Filtros usados", alt: "Filtros usados del equipo KA-135", stampedAt: "2026-10-27T15:30:00.000Z", receivedAt: "2026-10-27T15:31:00.000Z" },
  { id: "p2", caption: "Sticker de mantención", alt: "Sticker de mantención del equipo KA-135", stampedAt: "2026-10-27T15:32:00.000Z", receivedAt: "2026-10-27T15:33:00.000Z" },
  { id: "p3", caption: "Foto del trabajo", alt: "Foto del trabajo del equipo KA-135", stampedAt: "2026-10-27T15:34:00.000Z", receivedAt: "2026-10-27T15:35:00.000Z" },
]

const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })

describe("visor de fotos del detalle", () => {
  afterEach(cleanup)

  it("las miniaturas salen del endpoint autorizado y no de una URL pública", () => {
    render(<PhotoGallery photos={photos} />)
    const image = screen.getByAltText("Filtros usados del equipo KA-135")
    expect(image.getAttribute("src")).toBe("/api/mantencion/fotos/p1")
  })

  it("abre a pantalla completa con el sello, navega con flechas y cierra con Esc devolviendo el foco", async () => {
    render(<PhotoGallery photos={photos} />)
    const thumb = screen.getByRole("button", { name: /Filtros usados/ })
    thumb.focus()
    fireEvent.click(thumb)
    const dialog = await screen.findByRole("dialog")

    expect(within(dialog).getByText(/1 de 3/)).toBeTruthy()
    expect(within(dialog).getByText(/Sello/)).toBeTruthy()
    expect(within(dialog).getByRole("img", { name: /Filtros usados/ })).toBeTruthy()

    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    expect(within(dialog).getByText(/2 de 3/)).toBeTruthy()
    expect(within(dialog).getByRole("img", { name: /Sticker de mantención/ })).toBeTruthy()

    // La navegación da la vuelta: después de la última vuelve a la primera.
    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    expect(within(dialog).getByText(/1 de 3/)).toBeTruthy()
    fireEvent.keyDown(dialog, { key: "ArrowLeft" })
    expect(within(dialog).getByText(/3 de 3/)).toBeTruthy()

    fireEvent.keyDown(dialog, { key: "Escape" })
    await tick()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(thumb)
  })

  it("el zoom se acerca, se aleja y vuelve a «Ajustar» al cambiar de foto", async () => {
    render(<PhotoGallery photos={photos} />)
    fireEvent.click(screen.getByRole("button", { name: /Filtros usados/ }))
    const dialog = await screen.findByRole("dialog")
    const fit = within(dialog).getByRole("button", { name: "Ajustar a la pantalla" }) as HTMLButtonElement
    const zoomOut = within(dialog).getByRole("button", { name: "Alejar" }) as HTMLButtonElement
    expect(fit.disabled).toBe(true)
    expect(zoomOut.disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole("button", { name: "Acercar" }))
    expect(fit.disabled).toBe(false)
    expect(fit.textContent).toContain("150")
    fireEvent.keyDown(dialog, { key: "+" })
    expect(fit.textContent).toContain("200")
    fireEvent.keyDown(dialog, { key: "-" })
    expect(fit.textContent).toContain("150")

    fireEvent.click(within(dialog).getByRole("button", { name: "Foto siguiente" }))
    expect((within(dialog).getByRole("button", { name: "Ajustar a la pantalla" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("con una sola foto no ofrece flechas", async () => {
    render(<PhotoGallery photos={photos.slice(0, 1)} />)
    fireEvent.click(screen.getByRole("button", { name: /Filtros usados/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("button", { name: "Foto siguiente" })).toBeNull()
    expect(within(dialog).queryByRole("button", { name: "Foto anterior" })).toBeNull()
  })

  it("sin fotos lo dice con palabras", () => {
    render(<PhotoGallery photos={[]} />)
    expect(screen.getByText(/no trae fotos de respaldo/)).toBeTruthy()
  })
})
