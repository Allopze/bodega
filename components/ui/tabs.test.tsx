// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

const scrollIntoView = vi.fn()

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
})

afterEach(() => {
  scrollIntoView.mockClear()
})

function ExampleTabs() {
  return (
    <Tabs defaultValue="first">
      <TabsList aria-label="Secciones del ejemplo">
        <TabsTrigger value="first">Primera</TabsTrigger>
        <TabsTrigger value="second">Segunda</TabsTrigger>
        <TabsTrigger value="third">Tercera</TabsTrigger>
      </TabsList>
      <TabsContent value="first">Contenido primero</TabsContent>
      <TabsContent value="second">Contenido segundo</TabsContent>
      <TabsContent value="third">Contenido tercero</TabsContent>
    </Tabs>
  )
}

describe("TabsList", () => {
  it("lleva la pestaña activa a la zona visible al cargar y al cambiar de selección", async () => {
    render(<ExampleTabs />)

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" })
    const callsBeforeSelection = scrollIntoView.mock.calls.length

    fireEvent.click(screen.getByRole("tab", { name: "Tercera" }))

    await vi.waitFor(() => {
      expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsBeforeSelection)
    })
  })

  it("si la tira no cabe, centra la pestaña activa moviendo sólo la tira", async () => {
    render(<ExampleTabs />)
    const list = screen.getByRole("tablist", { name: "Secciones del ejemplo" })
    // jsdom no tiene layout: se declara una tira de 300 px con 600 px de contenido.
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 600 })
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 })
    list.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
    const third = screen.getByRole("tab", { name: "Tercera" })
    third.getBoundingClientRect = () => ({ left: 400, width: 100 }) as DOMRect

    // Radix activa la pestaña con mousedown (botón principal).
    fireEvent.mouseDown(third)

    // Centro de la activa (450) menos centro de la tira (150).
    await vi.waitFor(() => expect(list.scrollLeft).toBe(300))
  })
})
