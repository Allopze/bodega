// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const listMiperWorksiteTargetsAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ listMiperWorksiteTargetsAction }))

import { WorksiteSwitcher } from "./worksite-switcher"

const TARGETS = [
  { worksiteId: "ws-a", worksiteName: "Faena A", matrixId: "m1", period: 2026 },
  { worksiteId: "ws-b", worksiteName: "Faena B", matrixId: "m2", period: 2027 },
  { worksiteId: "ws-c", worksiteName: "Faena C", matrixId: null, period: null },
]
const abrir = () => fireEvent.keyDown(screen.getByRole("button", { name: "Cambiar de faena" }), { key: "Enter" })

afterEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("WorksiteSwitcher", () => {
  it("no pide la lista al pintarse: la pide al abrir el menú, una sola vez", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    expect(listMiperWorksiteTargetsAction).not.toHaveBeenCalled()
    abrir()
    expect(await screen.findByRole("menuitem", { name: "Faena B · 2027" })).toBeTruthy()
    expect(listMiperWorksiteTargetsAction).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    abrir()
    expect(await screen.findByRole("menuitem", { name: "Faena B · 2027" })).toBeTruthy()
    expect(listMiperWorksiteTargetsAction).toHaveBeenCalledTimes(1)
  })

  it("otra faena navega con router.push a su MIPER; una faena sin MIPER, a la portada acotada a ella", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    abrir()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Faena B · 2027" }))
    expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m2")
    abrir()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Faena C · sin MIPER" }))
    expect(router.push).toHaveBeenCalledWith("/prevencion/miper?faena=ws-c")
  })

  it("la MIPER actual queda marcada y no se puede elegir", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    abrir()
    expect(await screen.findByRole("menuitem", { name: "Faena A · 2026 (actual)" })).toHaveAttribute("aria-disabled", "true")
  })

  it("si la lectura falla lo dice y deja reintentar", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValueOnce({ ok: false, message: "No tienes permisos para realizar esta acción" })
    listMiperWorksiteTargetsAction.mockResolvedValueOnce({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    abrir()
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reintentar/ }))
    expect(await screen.findByRole("menuitem", { name: "Faena B · 2027" })).toBeTruthy()
    expect(listMiperWorksiteTargetsAction).toHaveBeenCalledTimes(2)
  })
})
