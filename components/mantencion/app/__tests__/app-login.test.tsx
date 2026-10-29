// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const signIn = vi.fn()
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signIn(...args) }))

const { AppLogin } = await import("../app-login")

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Correo"), { target: { value: email } })
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } })
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }))
}

describe("AppLogin (login propio de la app del mecánico)", () => {
  afterEach(() => { signIn.mockReset(); vi.unstubAllGlobals() })

  it("con credenciales inválidas muestra el mismo mensaje de la plataforma y no sale de la pantalla", async () => {
    signIn.mockResolvedValue({ error: "CredentialsSignin" })
    render(<AppLogin />)
    fill("Mecanico@Chome.cl", "mala")
    expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos.")
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "mecanico@chome.cl", password: "mala", redirect: false })
  })

  it("al entrar recarga la app, nunca el escritorio de la plataforma", async () => {
    signIn.mockResolvedValue({ ok: true })
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    render(<AppLogin />)
    fill("mecanico@chome.cl", "buena")
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/m/mantencion"))
  })

  it("sin correo o contraseña no llama al servidor", () => {
    render(<AppLogin />)
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe tu correo y tu contraseña.")
    expect(signIn).not.toHaveBeenCalled()
  })
})
