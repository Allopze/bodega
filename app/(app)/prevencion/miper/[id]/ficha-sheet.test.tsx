// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
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
})
