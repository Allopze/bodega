// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

Element.prototype.scrollIntoView = function scrollIntoView() {}

const setSparePartActiveAction = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock("@/app/(app)/mantencion/repuestos/actions", () => ({
  createSparePartAction: vi.fn(),
  updateSparePartAction: vi.fn(),
  setSparePartActiveAction: (...args: unknown[]) => setSparePartActiveAction(...args),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }))

const { SparePartDetailActions } = await import("./spare-part-detail-actions")

const PART = { id: "rep-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad", referencePrice: null, notes: null, isActive: true }
const UNITS = [{ code: "unidad", label: "Unidad" }]

describe("SparePartDetailActions", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("«Editar» abre el formulario con los datos del repuesto", async () => {
    render(<SparePartDetailActions part={PART} units={UNITS} />)
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }))
    const sheet = within(await screen.findByRole("dialog"))
    expect(sheet.getByText("Editar repuesto")).toBeTruthy()
    expect((sheet.getByRole("textbox", { name: /Nombre del repuesto/ }) as HTMLInputElement).value).toBe("Filtro de aceite")
  })

  it("desactivar pide confirmación y explica qué cambia; sólo confirmar llama a la acción", async () => {
    setSparePartActiveAction.mockResolvedValue({ ok: true, message: "Repuesto desactivado" })
    render(<SparePartDetailActions part={PART} units={UNITS} />)
    fireEvent.click(screen.getByRole("button", { name: /Desactivar/ }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText("Desactivar Filtro de aceite")).toBeTruthy()
    expect(dialog.getByText(/Su historial de compras y de precios se conserva/)).toBeTruthy()
    expect(setSparePartActiveAction).not.toHaveBeenCalled()

    fireEvent.click(dialog.getByRole("button", { name: "Desactivar" }))
    await waitFor(() => expect(setSparePartActiveAction).toHaveBeenCalledWith({ id: "rep-1", active: false }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Repuesto desactivado"))
  })

  it("si el servidor rechaza desactivar, el motivo queda dentro del diálogo, que sigue abierto", async () => {
    setSparePartActiveAction.mockResolvedValue({ ok: false, message: "No tienes permisos para realizar esta acción" })
    render(<SparePartDetailActions part={PART} units={UNITS} />)
    fireEvent.click(screen.getByRole("button", { name: /Desactivar/ }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.click(dialog.getByRole("button", { name: "Desactivar" }))
    expect((await dialog.findByRole("alert")).textContent).toContain("No tienes permisos para realizar esta acción")
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("un repuesto inactivo se reactiva con un clic, sin confirmación", async () => {
    setSparePartActiveAction.mockResolvedValue({ ok: true, message: "Repuesto activado" })
    render(<SparePartDetailActions part={{ ...PART, isActive: false }} units={UNITS} />)
    expect(screen.queryByRole("button", { name: /Desactivar/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Activar/ }))
    await waitFor(() => expect(setSparePartActiveAction).toHaveBeenCalledWith({ id: "rep-1", active: true }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Repuesto activado"))
  })

  it("si falla reactivar, lo dice en un aviso", async () => {
    setSparePartActiveAction.mockResolvedValue({ ok: false, message: "El repuesto no existe" })
    render(<SparePartDetailActions part={{ ...PART, isActive: false }} units={UNITS} />)
    fireEvent.click(screen.getByRole("button", { name: /Activar/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("El repuesto no existe"))
  })
})
