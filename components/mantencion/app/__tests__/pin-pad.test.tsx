// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PinPad } from "../pin-pad"

const keys = () => within(screen.getByRole("group", { name: "Teclado numérico" }))
const tap = (digit: string) => fireEvent.click(keys().getByRole("button", { name: digit }))
const dots = () => screen.getByRole("img", { name: /dígitos escritos/ })

describe("PinPad", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("al completar el cuarto dígito entrega el PIN una sola vez y se vacía, aun en modo estricto", () => {
    // El modo estricto ejecuta dos veces los actualizadores de estado: con el aviso dentro de uno
    // el PIN se entregaba (y se verificaba) dos veces.
    const onComplete = vi.fn()
    render(<StrictMode><PinPad onComplete={onComplete} /></StrictMode>)

    for (const digit of "1234") tap(digit)
    expect(dots()).toHaveAttribute("aria-label", "4 de 4 dígitos escritos")
    expect(onComplete).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(120) })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith("1234")
    expect(dots()).toHaveAttribute("aria-label", "0 de 4 dígitos escritos")

    // Queda listo para otro intento.
    for (const digit of "9876") tap(digit)
    act(() => { vi.advanceTimersByTime(120) })
    expect(onComplete).toHaveBeenLastCalledWith("9876")
    expect(onComplete).toHaveBeenCalledTimes(2)
  })

  it("no pasa de cuatro dígitos: lo que se toca antes del vaciado se ignora", () => {
    const onComplete = vi.fn()
    render(<PinPad onComplete={onComplete} />)

    for (const digit of "12345") tap(digit)
    expect(dots()).toHaveAttribute("aria-label", "4 de 4 dígitos escritos")
    act(() => { vi.advanceTimersByTime(120) })
    expect(onComplete).toHaveBeenCalledWith("1234")
  })

  it("«Borrar» quita el último dígito; con el cuarto ya puesto el PIN se entrega igual", () => {
    const onComplete = vi.fn()
    render(<PinPad onComplete={onComplete} />)

    tap("1"); tap("2")
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }))
    expect(dots()).toHaveAttribute("aria-label", "1 de 4 dígitos escritos")
    tap("3"); tap("4"); tap("5")
    expect(dots()).toHaveAttribute("aria-label", "4 de 4 dígitos escritos")

    fireEvent.click(screen.getByRole("button", { name: "Borrar" }))
    act(() => { vi.advanceTimersByTime(120) })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith("1345")
  })

  it("también se escribe con el teclado físico (dígitos y Backspace)", () => {
    const onComplete = vi.fn()
    render(<StrictMode><PinPad onComplete={onComplete} /></StrictMode>)

    fireEvent.keyDown(document, { key: "1" })
    fireEvent.keyDown(document, { key: "2" })
    fireEvent.keyDown(document, { key: "x" })
    fireEvent.keyDown(document, { key: "Backspace" })
    expect(dots()).toHaveAttribute("aria-label", "1 de 4 dígitos escritos")
    for (const key of "234") fireEvent.keyDown(document, { key })
    act(() => { vi.advanceTimersByTime(120) })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith("1234")
  })

  it("deshabilitado no escribe ni borra", () => {
    const onComplete = vi.fn()
    render(<PinPad onComplete={onComplete} disabled />)

    fireEvent.keyDown(document, { key: "1" })
    expect(dots()).toHaveAttribute("aria-label", "0 de 4 dígitos escritos")
    for (const button of keys().getAllByRole("button")) expect(button).toBeDisabled()
    act(() => { vi.advanceTimersByTime(500) })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("si la pantalla se desmonta antes del vaciado, el PIN no se entrega a nadie", () => {
    const onComplete = vi.fn()
    const { unmount } = render(<PinPad onComplete={onComplete} />)

    for (const digit of "1234") tap(digit)
    unmount()
    act(() => { vi.advanceTimersByTime(500) })
    expect(onComplete).not.toHaveBeenCalled()
  })
})
