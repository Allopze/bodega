// @vitest-environment jsdom

/**
 * El titular de un `ChartFrame` cambia de texto al apuntar una columna. En el Panel de
 * mantención, «Órdenes de trabajo: creadas, cerradas y en cola» pasaba de un pie de dos
 * renglones en reposo (51 px) a uno de un renglón al apuntar (28 px): el gráfico subía 22 px
 * bajo el puntero, el puntero caía en otra parte —o fuera del trazado— y el titular volvía a
 * cambiar. El gráfico temblaba y el marco cambiaba de alto (2026-11-19).
 *
 * jsdom no hace layout: el alto y el ancho del titular se fijan a mano y el
 * `ResizeObserver` se dispara a mano, igual que lo haría el navegador al reflujar el texto.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"

let observers: Array<() => void> = []
const OriginalResizeObserver = globalThis.ResizeObserver

beforeEach(() => {
  observers = []
  globalThis.ResizeObserver = class {
    private readonly callback: () => void
    constructor(callback: () => void) { this.callback = callback }
    observe() { observers.push(this.callback) }
    unobserve() {}
    disconnect() { observers = observers.filter((callback) => callback !== this.callback) }
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver
})

/** Lo que haría el navegador al reflujar el texto del titular: nuevo alto/ancho y aviso al observador. */
function reflow(inner: HTMLElement, size: { height: number; width?: number }) {
  const width = size.width ?? inner.getBoundingClientRect().width
  inner.getBoundingClientRect = () => ({ height: size.height, width } as DOMRect)
  act(() => observers.forEach((callback) => callback()))
}

function setup() {
  render(
    <ChartFrame
      title="Órdenes de trabajo: creadas, cerradas y en cola"
      headline={
        <>
          <ChartHeadlineValue>26</ChartHeadlineValue>
          <ChartHeadlineCaption>OT creadas en nov 2026</ChartHeadlineCaption>
        </>
      }
    >
      <button type="button">Ver datos</button>
    </ChartFrame>,
  )
  const frame = screen.getByRole("heading").closest<HTMLElement>("[data-chart-frame]")!
  const headline = frame.querySelector<HTMLElement>("[data-chart-headline]")!
  const inner = headline.firstElementChild as HTMLElement
  reflow(inner, { height: 51, width: 523 })
  return { frame, headline, inner }
}

describe("ChartFrame · el titular no mueve el gráfico al apuntar", () => {
  it("con el puntero dentro, un pie más corto no achica el titular; al salir vuelve a su alto natural", () => {
    const { frame, headline, inner } = setup()

    fireEvent.pointerEnter(frame)
    expect(headline.style.minHeight).toBe("51px")

    // Apuntar una columna: el pie pasa a un renglón.
    reflow(inner, { height: 28 })
    expect(headline.style.minHeight).toBe("51px")

    // Un pie más largo sí lo agranda, y desde ahí tampoco vuelve a achicarse.
    reflow(inner, { height: 72 })
    expect(headline.style.minHeight).toBe("72px")
    reflow(inner, { height: 28 })
    expect(headline.style.minHeight).toBe("72px")

    // Alto fraccionario: se reserva tal cual (redondearlo corría el gráfico 1 px).
    reflow(inner, { height: 72.4 })
    expect(headline.style.minHeight).toBe("72.4px")

    fireEvent.pointerLeave(frame)
    expect(headline.style.minHeight).toBe("")
  })

  it("en reposo no reserva alto: el titular mide lo que mide su texto", () => {
    const { headline, inner } = setup()
    reflow(inner, { height: 28 })
    expect(headline.style.minHeight).toBe("")
  })

  it("con el teclado (flechas sobre el gráfico) también lo sostiene hasta que el foco sale del marco", () => {
    const { frame, headline, inner } = setup()
    const button = screen.getByRole("button", { name: "Ver datos" })
    const outside = document.createElement("button")
    document.body.append(outside)

    fireEvent.focusIn(button)
    expect(headline.style.minHeight).toBe("51px")
    reflow(inner, { height: 28 })
    expect(headline.style.minHeight).toBe("51px")

    // El foco se mueve dentro del mismo marco: sigue sostenido.
    fireEvent.focusOut(button, { relatedTarget: frame.querySelector("h3") })
    expect(headline.style.minHeight).toBe("51px")

    fireEvent.focusOut(button, { relatedTarget: outside })
    expect(headline.style.minHeight).toBe("")
    outside.remove()
  })

  it("si cambia el ancho mientras se apunta, parte del alto que tiene en ese ancho", () => {
    const { frame, headline, inner } = setup()
    fireEvent.pointerEnter(frame)
    expect(headline.style.minHeight).toBe("51px")

    reflow(inner, { height: 28, width: 900 })
    expect(headline.style.minHeight).toBe("28px")
  })
})
