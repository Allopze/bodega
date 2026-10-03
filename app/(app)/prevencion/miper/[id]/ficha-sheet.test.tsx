// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("ficha=1") }))
const updateMiperHeaderAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Antecedentes guardados", data: { version: 2 } })))
vi.mock("../actions", () => ({ updateMiperHeaderAction }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { FichaSheet } from "./ficha-sheet"

const header = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-10-01", updatedOn: null, companyName: "Chome", companyRut: "1-9", companyAddress: "Calle 1",
  companyCommune: "Panguipulli", economicActivity: "Servicios", adherentNumber: null, worksiteName: "Planta", siteRepresentativeUserId: null,
  siteRepresentativeName: "Ana", headcountTotal: 2, headcountMale: 1, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
}
const workspace = {
  matrix: { id: "m1", version: 1 },
  snapshot: { header, entries: [] },
  versions: [],
  prefill: { companyName: "Chome", companyRut: "1-9", companyAddress: "Calle 1", economicActivity: "Servicios", adherentNumber: "", companyCommune: "Panguipulli", worksiteName: "Planta", siteRepresentativeUserId: null, siteRepresentativeName: "Ana", headcount: { total: 2, male: 1, female: 1, other: 0, unrecorded: 0 } },
} as unknown as MiperWorkspace

afterEach(() => { sessionStorage.clear() })

describe("FichaSheet", () => {
  it("se llama «Ficha del documento» y cierra sin preguntar si no hay cambios", () => {
    const onClose = vi.fn()
    render(<FichaSheet open onClose={onClose} workspace={workspace} editable />)
    const dialog = screen.getByRole("dialog", { name: "Ficha del documento" })
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("con cambios sin guardar, cerrar pide confirmación", async () => {
    const onClose = vi.fn()
    render(<FichaSheet open onClose={onClose} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    expect(onClose).not.toHaveBeenCalled()
    expect(await screen.findByRole("dialog", { name: "¿Cerrar sin guardar?" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sin guardar" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("al guardar, se cierra sin pedir confirmación", async () => {
    const onClose = vi.fn()
    render(<FichaSheet open onClose={onClose} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar antecedentes" }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(updateMiperHeaderAction).toHaveBeenCalledWith(expect.objectContaining({ matrixId: "m1", expectedVersion: 1, iperCode: "RE-04-B" }))
    expect(screen.queryByRole("dialog", { name: "¿Cerrar sin guardar?" })).toBeNull()
  })

  it("lo escrito sin guardar sobrevive a cerrar la ficha sin confirmar (Atrás) y al reabrirla se ofrece recuperarlo", () => {
    const first = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    expect(JSON.parse(sessionStorage.getItem("miper:ficha:m1:1")!)).toMatchObject({ iperCode: "RE-04-B" })
    // «Atrás» desmonta la ficha sin pasar por «¿Cerrar sin guardar?».
    first.unmount()
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.getByDisplayValue("RE-04")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Recuperar lo que no guardaste" }))
    expect(screen.getByDisplayValue("RE-04-B")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
  })

  it("«Descartar esos cambios» borra el borrador y no lo vuelve a ofrecer", () => {
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify({ iperCode: "RE-04-B" }))
    const first = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.click(screen.getByRole("button", { name: "Descartar esos cambios" }))
    expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull()
    first.unmount()
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
  })

  it("un borrador de otra versión (alguien guardó la ficha después) o igual a lo guardado no se ofrece", () => {
    sessionStorage.setItem("miper:ficha:m1:0", JSON.stringify({ iperCode: "VIEJO" }))
    const first = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
    first.unmount()
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify({ iperCode: "RE-04" }))
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
  })

  it("guardar y «Cerrar sin guardar» borran el borrador", async () => {
    const saved = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar antecedentes" }))
    await waitFor(() => expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull())
    saved.unmount()

    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-C" } })
    expect(sessionStorage.getItem("miper:ficha:m1:1")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sin guardar" }))
    expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull()
  })

  it("escribir antes de recuperar quita el aviso: «Recuperar» ya no puede pisar lo nuevo", () => {
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify({ iperCode: "RE-04-B" }))
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.getByRole("button", { name: "Recuperar lo que no guardaste" })).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue("Chome"), { target: { value: "Chome SpA" } })
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
    expect(screen.getByDisplayValue("Chome SpA")).toBeTruthy()
    expect(JSON.parse(sessionStorage.getItem("miper:ficha:m1:1")!)).toMatchObject({ iperCode: "RE-04", companyName: "Chome SpA" })
  })

  it("deshacer hasta lo guardado borra el borrador; uno sin decidir se conserva", () => {
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify({ iperCode: "RE-04-B" }))
    const pending = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    // Abrir la ficha sin tocar el aviso no lo pierde.
    expect(sessionStorage.getItem("miper:ficha:m1:1")).not.toBeNull()
    pending.unmount()
    sessionStorage.clear()

    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    expect(sessionStorage.getItem("miper:ficha:m1:1")).not.toBeNull()
    fireEvent.change(screen.getByDisplayValue("RE-04-B"), { target: { value: "RE-04" } })
    expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull()
  })

  it("con cambios sin guardar, cerrar o recargar la pestaña lo advierte (beforeunload)", () => {
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    const before = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    const after = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(true)
  })

  it("mientras guarda, los campos quedan deshabilitados", async () => {
    updateMiperHeaderAction.mockReturnValueOnce(new Promise<never>(() => {}))
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar antecedentes" }))
    await waitFor(() => expect(screen.getByDisplayValue("RE-04-B")).toBeDisabled())
    expect(screen.getByDisplayValue("Chome")).toBeDisabled()
  })
})
