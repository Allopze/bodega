// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true })
}

/** Cada caso carga el módulo de nuevo: el evento guardado vive en una variable de módulo. */
async function renderPrompt() {
  vi.resetModules()
  const { InstallPrompt } = await import("../install-prompt")
  return render(<InstallPrompt />)
}

describe("InstallPrompt", () => {
  beforeEach(() => { window.localStorage.clear() })
  afterEach(() => { setUserAgent(DESKTOP) })

  it("en Chrome, cuando el navegador la ofrece, muestra «Instalar app» y abre el diálogo nativo", async () => {
    setUserAgent(DESKTOP)
    await renderPrompt()
    expect(screen.queryByRole("region", { name: /Instala la app/ })).not.toBeInTheDocument()

    const prompt = vi.fn().mockResolvedValue(undefined)
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt, userChoice: Promise.resolve({ outcome: "accepted" }),
      }))
    })
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Instalar app" })) })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("region", { name: /Instala la app/ })).not.toBeInTheDocument()
  })

  it("en iPhone muestra los pasos de Safari y «Ahora no» la calla", async () => {
    setUserAgent(IPHONE)
    await renderPrompt()
    expect(await screen.findByRole("region", { name: "Instala la app en tu iPhone" })).toBeInTheDocument()
    expect(screen.getByText("Agregar a inicio")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }))
    expect(screen.queryByRole("region", { name: /Instala la app/ })).not.toBeInTheDocument()
    expect(window.localStorage.getItem("mant-install-snoozed-at")).not.toBeNull()
  })

  it("abierta como app instalada no invita a instalar", async () => {
    setUserAgent(IPHONE)
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true })
    await renderPrompt()
    expect(screen.queryByRole("region", { name: /Instala la app/ })).not.toBeInTheDocument()
    Object.defineProperty(window.navigator, "standalone", { value: undefined, configurable: true })
  })
})
